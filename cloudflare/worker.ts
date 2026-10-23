import { handleAsNodeRequest } from "cloudflare:node";
import { app } from "../apps/api/src/app.js";
import { configureWebhookQueue, enqueuePendingWebhookDeliveries, markWebhookDeadLetter, processWebhookDelivery } from "../apps/api/src/services/webhook-queue.js";
import { configureDatabaseConnection, withDatabaseRequest } from "../apps/api/src/services/prisma.js";
import { configurePayrollExport, enqueuePendingPayrollExports, expirePayrollExports, markPayrollExportDeadLetter, processPayrollExport, type PrivateBucket } from "../apps/api/src/services/payroll-export.js";
import { purgeExpiredExactGps } from "../apps/api/src/services/gps-retention.js";
import { detectAttendanceExceptions } from "../apps/api/src/services/attendance-exceptions.js";

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
type WorkerEnvironment = { WEBHOOK_QUEUE?: QueueProducer; PAYROLL_EXPORT_QUEUE?: QueueProducer; PAYROLL_EXPORTS?: PrivateBucket; AUTH_RATE_LIMITER?: RateLimiter; HYPERDRIVE?: Hyperdrive; FEATURE_PAYROLL?: string };

function configureBindings(environment: WorkerEnvironment): void {
  configureWebhookQueue(environment.WEBHOOK_QUEUE);
  configurePayrollExport(environment.PAYROLL_EXPORT_QUEUE, environment.PAYROLL_EXPORTS);
  configureDatabaseConnection(environment.HYPERDRIVE?.connectionString);
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
    return withDatabaseRequest(async () => {
      const pathname = new URL(request.url).pathname;
      if (environment.AUTH_RATE_LIMITER && protectedAuthPaths.has(pathname)) {
        const result = await environment.AUTH_RATE_LIMITER.limit({ key: authRateLimitKey(request) });
        if (!result.success) return Response.json({ error: { code: "RATE_LIMITED", message: "Too many attempts. Try again shortly." } }, { status: 429 });
      }
      return handleAsNodeRequest(port, request);
    });
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
        ...(environment.FEATURE_PAYROLL === "true" ? [enqueuePendingPayrollExports(), expirePayrollExports()] : []),
      ]);
    });
  },
};
