import { clearSession, getSession } from "./auth";
import { apiUrl } from "./api";

export type AdminEmployee = { id: string; employeeId: string | null; username: string; firstName: string; lastName: string; isActive: boolean; clientId: string | null };
export type EmployeeInput = { username: string; password: string; firstName: string; lastName: string; clientId?: string };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1${path}`, { ...options, headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", ...options?.headers } });
  if (response.status === 401) { clearSession(); throw new Error("Your session has expired. Please sign in again."); }
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to update employees");
  return body as T;
}

export async function getAdminEmployees(): Promise<AdminEmployee[]> { return (await request<{ employees: AdminEmployee[] }>("/admin/employees")).employees; }
export async function createAdminEmployee(input: EmployeeInput): Promise<AdminEmployee> { return (await request<{ employee: AdminEmployee }>("/admin/employees", { method: "POST", body: JSON.stringify(input) })).employee; }
export async function updateAdminEmployeeStatus(id: string, isActive: boolean): Promise<AdminEmployee> { return (await request<{ employee: AdminEmployee }>(`/admin/employees/${id}/status`, { method: "PATCH", body: JSON.stringify({ isActive }) })).employee; }
