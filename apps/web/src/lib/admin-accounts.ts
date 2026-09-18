import { clearSession, getSession } from "./auth";
import { apiUrl } from "./api";

export type AdminAccount = { id: string; email: string; role: "ADMIN"; isActive: boolean; displayName: string | null; clientId: string | null; clientName: string | null };
export type AdminAccountInput = { email: string; displayName: string; clientId: string; password: string };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1${path}`, { ...options, headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", ...options?.headers } });
  if (response.status === 401) { clearSession(); throw new Error("Your session has expired. Please sign in again."); }
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to manage accounts");
  return body as T;
}

export async function getAdminAccounts(): Promise<AdminAccount[]> { return (await request<{ admins: AdminAccount[] }>("/admin/admins")).admins; }
export async function createAdminAccount(input: AdminAccountInput): Promise<AdminAccount> { return (await request<{ admin: AdminAccount }>("/admin/admins", { method: "POST", body: JSON.stringify(input) })).admin; }
export async function resetManagedAccountPassword(id: string, password: string): Promise<void> { await request(`/admin/accounts/${id}/password`, { method: "PATCH", body: JSON.stringify({ password }) }); }
