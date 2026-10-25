import { authenticatedFetch } from "./auth";

export type EmployeeOwnerAdmin = { id: string; username: string; displayName: string | null };
export type AdminEmployee = { id: string; employeeId: string | null; username: string; firstName: string; lastName: string; isActive: boolean; clientId: string | null; ownerAdmin: EmployeeOwnerAdmin | null };
export type EmployeeInput = { username: string; password: string; firstName: string; lastName: string };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/v1${path}`, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to update employees");
  return body as T;
}

export async function getAdminEmployees(): Promise<AdminEmployee[]> { return (await request<{ employees: AdminEmployee[] }>("/admin/employees")).employees; }
export async function createAdminEmployee(input: EmployeeInput): Promise<AdminEmployee> { return (await request<{ employee: AdminEmployee }>("/admin/employees", { method: "POST", body: JSON.stringify(input) })).employee; }
export async function updateAdminEmployeeStatus(id: string, isActive: boolean): Promise<AdminEmployee> { return (await request<{ employee: AdminEmployee }>(`/admin/employees/${id}/status`, { method: "PATCH", body: JSON.stringify({ isActive }) })).employee; }
