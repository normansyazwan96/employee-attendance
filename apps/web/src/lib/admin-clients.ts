import { authenticatedFetch } from "./auth";

export type AdminClient = { id: string; name: string; stateCode?: string | null; isTest: boolean };
export async function getAdminClients(): Promise<AdminClient[]> {
  const response = await authenticatedFetch("/api/v1/admin/clients");
  const body = await response.json() as { clients?: AdminClient[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to load clients");
  return body.clients ?? [];
}

export async function createAdminClient(input: { name: string; stateCode?: string | null; isTest: boolean }): Promise<AdminClient> {
  const response = await authenticatedFetch("/api/v1/admin/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  const body = await response.json() as { client?: AdminClient; error?: string };
  if (!response.ok || !body.client) throw new Error(body.error ?? "Unable to create organization");
  return body.client;
}

export async function selectOrganizationContext(clientId: string): Promise<void> {
  const response = await authenticatedFetch("/api/v1/admin/organization-context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: clientId || null }) });
  if (!response.ok) {
    const body = await response.json() as { error?: string };
    throw new Error(body.error ?? "Unable to select organization");
  }
}
