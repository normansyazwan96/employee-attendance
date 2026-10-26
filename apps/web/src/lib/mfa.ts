import { authenticatedFetch } from "./auth";

type ApiError = { error?: string | { message?: string } };
const errorMessage = (body: ApiError, fallback: string) => typeof body.error === "string" ? body.error : body.error?.message ?? fallback;

export async function beginMfaSetup(): Promise<{ secret: string; uri: string }> {
  const response = await authenticatedFetch("/api/v2/auth/2fa/setup", { method: "POST" });
  const body = await response.json() as { secret?: string; uri?: string } & ApiError;
  if (!response.ok || !body.secret || !body.uri) throw new Error(errorMessage(body, "Unable to start two-factor authentication setup"));
  return { secret: body.secret, uri: body.uri };
}

export async function enableMfa(code: string): Promise<string[]> {
  const response = await authenticatedFetch("/api/v2/auth/2fa/enable", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
  const body = await response.json() as { recoveryCodes?: string[] } & ApiError;
  if (!response.ok || !body.recoveryCodes) throw new Error(errorMessage(body, "Unable to enable two-factor authentication"));
  return body.recoveryCodes;
}
