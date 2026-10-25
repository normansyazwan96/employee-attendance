import { authenticatedFetch } from "./auth";

export type Worksite = { id: string; name: string; stateCode: string; latitude: number; longitude: number; radiusMeters: number; isActive: boolean; ownerAdminId: string | null; canManage: boolean; createdAt: string; updatedAt: string };
export type WorksiteInput = Pick<Worksite, "name" | "stateCode" | "latitude" | "longitude" | "radiusMeters" | "isActive">;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(`/api/v1${path}`, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Unable to update worksites"); }
  return response.status === 204 ? (undefined as T) : await response.json() as T;
}

export async function getWorksites(): Promise<Worksite[]> { return (await request<{ worksites: Worksite[] }>("/admin/worksites")).worksites; }
export async function createWorksite(input: WorksiteInput): Promise<Worksite> { return (await request<{ worksite: Worksite }>("/admin/worksites", { method: "POST", body: JSON.stringify(input) })).worksite; }
export async function updateWorksite(id: string, input: WorksiteInput): Promise<Worksite> { return (await request<{ worksite: Worksite }>(`/admin/worksites/${id}`, { method: "PATCH", body: JSON.stringify(input) })).worksite; }
export async function deleteWorksite(id: string): Promise<void> { await request<void>(`/admin/worksites/${id}`, { method: "DELETE" }); }
