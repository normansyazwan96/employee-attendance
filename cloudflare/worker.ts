import { handleAsNodeRequest } from "cloudflare:node";
import { app } from "../apps/api/src/app.js";
import { configureWebhookQueue, enqueuePendingWebhookDeliveries, markWebhookDeadLetter, processWebhookDelivery } from "../apps/api/src/services/webhook-queue.js";
import { configureD1Database, configureDatabaseConnection, withDatabaseRequest } from "../apps/api/src/services/prisma.js";
import { configurePayrollExport, enqueuePendingPayrollExports, expirePayrollExports, markPayrollExportDeadLetter, processPayrollExport, type PrivateBucket } from "../apps/api/src/services/payroll-export.js";
import { purgeExpiredExactGps } from "../apps/api/src/services/gps-retention.js";
import { detectAttendanceExceptions } from "../apps/api/src/services/attendance-exceptions.js";
import { configureD1Shadow, getD1ShadowStatus, type D1DatabaseBinding, type D1ReadMode } from "../apps/api/src/services/d1-shadow.js";
import { remindDevAdminsToImportNextYearHolidays } from "../apps/api/src/services/malaysia-holidays.js";
import { verifyDatabaseRecoveryReadiness } from "../apps/api/src/services/database-recovery.js";

const port = 3000;

app.listen(port);

type QueueMessage = {
  body: unknown;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
};

type QueueBatch = { queue: string; messages: QueueMessage[] };
type QueueProducer = { send(body: { deliveryId: string }): Promise<void> };
type RateLimiter = { limit(input: { key: string }): Promise<{ success: boolean }> };
type Hyperdrive = { connectionString: string };
type DurableObjectStub = { fetch(request: Request): Promise<Response> };
type DurableObjectNamespace = { getByName(name: string): DurableObjectStub };
type WorkerEnvironment = { WEBHOOK_QUEUE?: QueueProducer; PAYROLL_EXPORT_QUEUE?: QueueProducer; PAYROLL_EXPORTS?: PrivateBucket; AUTH_RATE_LIMITER?: RateLimiter; HYPERDRIVE?: Hyperdrive; DB?: D1DatabaseBinding; D1_SHADOW?: D1DatabaseBinding; DATABASE_WRITE_COORDINATOR?: DurableObjectNamespace; DATABASE_BACKEND?: "neon" | "d1"; D1_READ_MODE?: D1ReadMode; APP_ENV?: string; FEATURE_PAYROLL?: string };

function configureBindings(environment: WorkerEnvironment): void {
  configureWebhookQueue(environment.WEBHOOK_QUEUE);
  configurePayrollExport(environment.PAYROLL_EXPORT_QUEUE, environment.PAYROLL_EXPORTS);
  configureDatabaseConnection(environment.HYPERDRIVE?.connectionString);
  configureD1Database(environment.DATABASE_BACKEND === "d1" ? environment.DB : undefined);
  configureD1Shadow(environment.D1_SHADOW, environment.D1_READ_MODE ?? "off");
}

function mutatesDatabase(request: Request): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase());
}

function databaseWriteCoordinatorName(request: Request): string {
  const pathname = new URL(request.url).pathname;
  if (!pathname.startsWith("/api/v2/attendance/events/")) return "global";
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body = token?.split(".")[1];
  if (!body) return "global";
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub?: unknown };
    return typeof payload.sub === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(payload.sub)
      ? `attendance:${payload.sub}`
      : "global";
  } catch {
    return "global";
  }
}

async function handleApplicationRequest(request: Request, environment: WorkerEnvironment): Promise<Response> {
  configureBindings(environment);
  return withDatabaseRequest(() => handleAsNodeRequest(port, request));
}

export class DatabaseWriteCoordinator {
  constructor(_state: unknown, private readonly environment: WorkerEnvironment) {}

  async fetch(request: Request): Promise<Response> {
    return handleApplicationRequest(request, this.environment);
  }
}

const protectedAuthPaths = new Set([
  "/api/v1/auth/login",
  "/api/v2/auth/login",
  "/api/v2/auth/2fa/verify-login",
  "/api/v2/auth/password-recovery",
  "/api/v2/auth/password-reset",
]);

function authRateLimitKey(request: Request): string {
  const address = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return `${new URL(request.url).pathname}:${address}`;
}

function deliveryId(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("deliveryId" in body)) return null;
  const value = (body as { deliveryId?: unknown }).deliveryId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function exportJobId(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("jobId" in body)) return null;
  const value = (body as { jobId?: unknown }).jobId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export default {
  async fetch(request: Request, environment: WorkerEnvironment): Promise<Response> {
    configureBindings(environment);
    const pathname = new URL(request.url).pathname;
    if (pathname === "/api/v2/health/d1-shadow" && environment.APP_ENV === "staging") {
      if (!environment.D1_SHADOW) return Response.json({ status: "unavailable" }, { status: 503 });
      const result = await environment.D1_SHADOW.prepare("SELECT count(*) AS applicationTables FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations'").first<{ applicationTables: number }>();
      const healthy = result?.applicationTables === 42;
      return Response.json({ status: healthy ? "ok" : "degraded", checks: { database: "d1-shadow", applicationTables: result?.applicationTables ?? 0, reads: getD1ShadowStatus() } }, { status: healthy ? 200 : 503, headers: { "cache-control": "no-store" } });
    }
    if (environment.AUTH_RATE_LIMITER && protectedAuthPaths.has(pathname)) {
      const result = await environment.AUTH_RATE_LIMITER.limit({ key: authRateLimitKey(request) });
      if (!result.success) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." } }, { status: 429 });
    }
    if (environment.DATABASE_BACKEND === "d1" && mutatesDatabase(request)) {
      if (!environment.DATABASE_WRITE_COORDINATOR) return Response.json({ error: "Database write coordinator is unavailable" }, { status: 503 });
      return environment.DATABASE_WRITE_COORDINATOR.getByName(databaseWriteCoordinatorName(request)).fetch(request);
    }
    return handleApplicationRequest(request, environment);
  },
  async queue(batch: QueueBatch, environment: WorkerEnvironment): Promise<void> {
    configureBindings(environment);
    await withDatabaseRequest(async () => {
      const deadLetter = batch.queue.endsWith("-dead-letter");
      const payrollExport = batch.queue.includes("payroll-exports");
      await Promise.all(batch.messages.map(async (message) => {
        if (payrollExport) {
          if (environment.FEATURE_PAYROLL !== "true") { message.ack(); return; }
          const id = exportJobId(message.body);
          if (!id) { message.ack(); return; }
          try {
            if (deadLetter) await markPayrollExportDeadLetter(id);
            else await processPayrollExport(id);
            message.ack();
          } catch {
            message.retry();
          }
          return;
        }
        const id = deliveryId(message.body);
        if (!id) {
          message.ack();
          return;
        }
        try {
          if (deadLetter) await markWebhookDeadLetter(id);
          else await processWebhookDelivery(id);
          message.ack();
        } catch {
          message.retry();
        }
      }));
    });
  },
  async scheduled(_controller: unknown, environment: WorkerEnvironment): Promise<void> {
    configureBindings(environment);
    await withDatabaseRequest(async () => {
      await Promise.all([
        enqueuePendingWebhookDeliveries(),
        purgeExpiredExactGps(),
        detectAttendanceExceptions(),
        remindDevAdminsToImportNextYearHolidays(),
        verifyDatabaseRecoveryReadiness(),
        ...(environment.FEATURE_PAYROLL === "true" ? [enqueuePendingPayrollExports(), expirePayrollExports()] : []),
      ]);
    });
  },
};
