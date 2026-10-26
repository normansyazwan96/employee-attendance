import { apiUrl, withLanguage } from "./api";

type ApiError = { error?: string | { message?: string } };
const message = (body: ApiError, fallback: string) => typeof body.error === "string" ? body.error : body.error?.message ?? fallback;

export async function requestPasswordRecovery(email: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v2/auth/password-recovery`, { method: "POST", headers: withLanguage({ "Content-Type": "application/json" }), body: JSON.stringify({ email }) });
  if (!response.ok) throw new Error(message(await response.json() as ApiError, "Unable to request a password reset"));
}

export async function resetPassword(token: string, password: string): Promise<void> {
  const response = await fetch(`${apiUrl}/api/v2/auth/password-reset`, { method: "POST", headers: withLanguage({ "Content-Type": "application/json" }), body: JSON.stringify({ token, password }) });
  if (!response.ok) throw new Error(message(await response.json() as ApiError, "Unable to reset the password"));
}
