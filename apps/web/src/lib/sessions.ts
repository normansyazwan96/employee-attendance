import { authenticatedFetch } from "./auth";

export type ActiveSession = { id: string; createdAt: string; lastUsedAt: string; expiresAt: string; ipAddress: string | null; userAgent: string | null; current: boolean };
export async function getActiveSessions(): Promise<ActiveSession[]> { const response = await authenticatedFetch("/api/v2/auth/sessions"); const body = await response.json() as { data?: ActiveSession[]; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "Unable to load sessions"); return body.data ?? []; }
export async function revokeActiveSession(id: string): Promise<void> { const response = await authenticatedFetch(`/api/v2/auth/sessions/${id}`, { method: "DELETE" }); if (!response.ok) { const body = await response.json() as { error?: { message?: string } }; throw new Error(body.error?.message ?? "Unable to revoke session"); } }
