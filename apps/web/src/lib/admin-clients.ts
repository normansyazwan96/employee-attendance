import { getSession } from "./auth";
import { apiUrl } from "./api";

export type AdminClient = { id: string; name: string };
export async function getAdminClients(): Promise<AdminClient[]> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1/admin/clients`, { headers: { Authorization: `Bearer ${session.token}` } });
  const body = await response.json() as { clients?: AdminClient[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to load clients");
  return body.clients ?? [];
}
