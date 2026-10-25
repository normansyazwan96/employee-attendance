import { authenticatedFetch } from "./auth";

export type WebhookDetails = {
  enabled: boolean;
  url: string | null;
  secretConfigured: boolean;
  events: string[];
  method: string;
  contentType: string;
  signatureHeader: string;
  signatureAlgorithm: string;
  failureBehavior: string;
  delivery: { mode: string; maxRetries: number; retryDelaySeconds: number; deadLetterQueue: boolean };
};
export type WebhookDelivery = { id: string; eventType: string; status: string; attempts: number; responseStatus: number | null; lastError: string | null; createdAt: string; deliveredAt: string | null };
export type DatabaseRecoveryStatus = {
  healthy: boolean;
  totals: { organizations: number; liveOrganizations: number; testOrganizations: number; users: number; employees: number; attendanceEvents: number; timesheetDays: number; auditLogs: number; latestAttendanceEventAt: string | null; ownerCount: number; foreignKeyViolations: number; integrity: string };
  latestCheck: { action: string; details: unknown; createdAt: string } | null;
  latestDrill: { details: unknown; createdAt: string } | null;
};

export async function getWebhookDetails(): Promise<WebhookDetails> {
  const response = await authenticatedFetch("/api/v1/admin/system/webhook");
  const body = await response.json() as { webhook?: WebhookDetails; error?: string };
  if (!response.ok || !body.webhook) throw new Error(body.error ?? "Unable to load webhook details");
  return body.webhook;
}
export async function getWebhookDeliveries(): Promise<WebhookDelivery[]> { const response = await authenticatedFetch("/api/v1/admin/system/webhook/deliveries"); const body = await response.json() as { data?: WebhookDelivery[]; error?: string }; if (!response.ok) throw new Error(body.error ?? "Unable to load webhook deliveries"); return body.data ?? []; }
export async function getDatabaseRecoveryStatus(): Promise<DatabaseRecoveryStatus> { const response = await authenticatedFetch("/api/v1/admin/system/recovery"); const body = await response.json() as { recovery?: DatabaseRecoveryStatus; error?: string }; if (!response.ok || !body.recovery) throw new Error(body.error ?? "Unable to load database recovery status"); return body.recovery; }
