import { clearSession, getSession } from "./auth";

export type Worksite = { id: string; name: string; latitude: number; longitude: number; radiusMeters: number; isActive: boolean; createdAt: string; updatedAt: string };
export type WorksiteInput = Pick<Worksite, "name" | "latitude" | "longitude" | "radiusMeters" | "isActive">;
const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1${path}`, { ...options, headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", ...options?.headers } });
  if (response.status === 401) { clearSession(); throw new Error("Your session has expired. Please sign in again."); }
  if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Unable to update worksites"); }
  return response.status === 204 ? (undefined as T) : await response.json() as T;
}

export async function getWorksites(): Promise<Worksite[]> { return (await request<{ worksites: Worksite[] }>("/admin/worksites")).worksites; }
export async function createWorksite(input: WorksiteInput): Promise<Worksite> { return (await request<{ worksite: Worksite }>("/admin/worksites", { method: "POST", body: JSON.stringify(input) })).worksite; }
export async function updateWorksite(id: string, input: WorksiteInput): Promise<Worksite> { return (await request<{ worksite: Worksite }>(`/admin/worksites/${id}`, { method: "PATCH", body: JSON.stringify(input) })).worksite; }
export async function deleteWorksite(id: string): Promise<void> { await request<void>(`/admin/worksites/${id}`, { method: "DELETE" }); }
