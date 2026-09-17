import { clearSession, getSession } from "./auth";

export type AuditEntry = { id: string; actorUserId: string; clientId: string | null; action: string; entityType: string; entityId: string; details: Record<string, unknown> | null; createdAt: string };
const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export async function getAdminAudit(): Promise<AuditEntry[]> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1/admin/audit`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (response.status === 401) { clearSession(); throw new Error("Your session has expired. Please sign in again."); }
  const body = await response.json() as { audit?: AuditEntry[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to load audit history");
  return body.audit ?? [];
}
