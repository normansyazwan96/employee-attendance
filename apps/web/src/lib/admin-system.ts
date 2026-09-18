import { clearSession, getSession } from "./auth";
import { apiUrl } from "./api";

export type WebhookDetails = {
  enabled: boolean;
  url: string | null;
  secretConfigured: boolean;
  events: string[];
  method: string;
  contentType: string;
  signatureHeader: string;
  signatureAlgorithm: string;
  failureBehavior: string;
};

export async function getWebhookDetails(): Promise<WebhookDetails> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1/admin/system/webhook`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (response.status === 401) { clearSession(); throw new Error("Your session has expired. Please sign in again."); }
  const body = await response.json() as { webhook?: WebhookDetails; error?: string };
  if (!response.ok || !body.webhook) throw new Error(body.error ?? "Unable to load webhook details");
  return body.webhook;
}
