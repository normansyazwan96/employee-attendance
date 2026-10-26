import { authenticatedFetch } from "./auth";

export type AuditEntry = { id: string; actorUserId: string; clientId: string | null; action: string; entityType: string; entityId: string; details: Record<string, unknown> | null; createdAt: string };

export async function getAdminAudit(): Promise<AuditEntry[]> {
  const response = await authenticatedFetch("/api/v1/admin/audit");
  const body = await response.json() as { audit?: AuditEntry[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to load audit history");
  return body.audit ?? [];
}
