export type Role = "EMPLOYEE" | "ADMIN" | "DEV_ADMIN";
export type SessionUser = { id: string; email: string; role: Role; name: string | null };
export type Session = { token: string; user: SessionUser };

const storageKey = "attendance.session";
const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export function getSession(): Session | null {
  const raw = localStorage.getItem(storageKey);
  if (!raw) return null;
  try { return JSON.parse(raw) as Session; } catch { localStorage.removeItem(storageKey); return null; }
}
export function saveSession(session: Session): void { localStorage.setItem(storageKey, JSON.stringify(session)); }
export function clearSession(): void { localStorage.removeItem(storageKey); }
export function rolePath(role: Role): string { return role === "DEV_ADMIN" ? "/dev" : role === "ADMIN" ? "/admin" : "/employee"; }
export async function login(email: string, password: string): Promise<Session> {
  const response = await fetch(`${apiUrl}/api/v1/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  const body = await response.json() as Session | { error: string };
  if (!response.ok || !("token" in body)) throw new Error("error" in body ? body.error : "Unable to sign in");
  saveSession(body);
  return body;
}
