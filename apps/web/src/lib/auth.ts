import { apiUrl, withLanguage } from "./api";

export type Role = "EMPLOYEE" | "ADMIN" | "MANAGER" | "GLOBAL_ADMIN" | "DEV_ADMIN";
export type MembershipRole = "ADMIN" | "MANAGER" | "EMPLOYEE";
export type SessionUser = {
  id: string;
  username: string;
  role: Role;
  platformRole?: "USER" | "GLOBAL_ADMIN" | "DEV_ADMIN";
  name: string | null;
  mustChangePassword: boolean;
  memberships?: Array<{ id: string; clientId: string; role: MembershipRole; status: "ACTIVE" | "INACTIVE" }>;
};
export type Session = { token: string; user: SessionUser };

type SessionResponse = { accessToken: string; expiresIn: number; user: SessionUser };
export type MfaChallenge = { mfaRequired: true; challengeToken: string };
type ApiError = { error?: string | { code?: string; message?: string } };

const userStorageKey = "attendance.user";
const legacyStorageKey = "attendance.session";
const organizationStorageKey = "attendance.organizationId";
let accessToken: string | null = null;
let refreshPromise: Promise<string> | null = null;

function errorMessage(body: ApiError, fallback: string): string {
  if (typeof body.error === "string") return body.error;
  return body.error?.message ?? fallback;
}

function readStoredUser(): SessionUser | null {
  const stored = localStorage.getItem(userStorageKey);
  if (stored) {
    try { return JSON.parse(stored) as SessionUser; } catch { localStorage.removeItem(userStorageKey); }
  }
  const legacy = localStorage.getItem(legacyStorageKey);
  if (!legacy) return null;
  try {
    const user = (JSON.parse(legacy) as { user?: SessionUser }).user;
    localStorage.removeItem(legacyStorageKey);
    if (user) localStorage.setItem(userStorageKey, JSON.stringify(user));
    return user ?? null;
  } catch {
    localStorage.removeItem(legacyStorageKey);
    return null;
  }
}

export function getSession(): Session | null {
  const user = readStoredUser();
  return user ? { token: accessToken ?? "", user } : null;
}
export function saveSession(session: Session): void {
  accessToken = session.token;
  localStorage.setItem(userStorageKey, JSON.stringify(session.user));
  localStorage.removeItem(legacyStorageKey);
}
export function clearSession(): void {
  accessToken = null;
  localStorage.removeItem(userStorageKey);
  localStorage.removeItem(legacyStorageKey);
  localStorage.removeItem(organizationStorageKey);
}
export function getSelectedOrganizationId(): string { return localStorage.getItem(organizationStorageKey) ?? ""; }
export function setSelectedOrganizationId(clientId: string): void {
  if (clientId) localStorage.setItem(organizationStorageKey, clientId);
  else localStorage.removeItem(organizationStorageKey);
}
export function rolePath(role: Role): string { return role === "DEV_ADMIN" ? "/dev" : role === "GLOBAL_ADMIN" ? "/global" : role === "ADMIN" ? "/admin" : role === "MANAGER" ? "/manager" : "/employee"; }
export function sessionPath(user: SessionUser): string { return user.mustChangePassword ? "/profile" : rolePath(user.role); }
export function updateSession(token: string, user: SessionUser): void { saveSession({ token, user }); }

async function refreshAccessToken(): Promise<string> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      const response = await fetch(`${apiUrl}/api/v2/auth/refresh`, { method: "POST", credentials: "include", headers: withLanguage() });
      const body = await response.json() as SessionResponse | ApiError;
      if (!response.ok || !("accessToken" in body)) {
        if (response.status === 401) clearSession();
        throw new Error(errorMessage(body as ApiError, "Your session has expired. Please sign in again."));
      }
      saveSession({ token: body.accessToken, user: body.user });
      return body.accessToken;
    })().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function requestWithToken(path: string, options: RequestInit, token: string): Promise<Response> {
  const headers = new Headers(options.headers);
  withLanguage().forEach((value, key) => headers.set(key, value));
  headers.set("Authorization", `Bearer ${token}`);
  const organizationId = getSelectedOrganizationId();
  if (organizationId) headers.set("x-organization-id", organizationId);
  return fetch(`${apiUrl}${path}`, { ...options, headers, credentials: "include" });
}

export async function authenticatedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = accessToken ?? await refreshAccessToken();
  const response = await requestWithToken(path, options, token);
  if (response.status !== 401) return response;
  accessToken = null;
  const refreshedToken = await refreshAccessToken();
  return requestWithToken(path, options, refreshedToken);
}

export async function login(username: string, password: string): Promise<Session | MfaChallenge> {
  const response = await fetch(`${apiUrl}/api/v2/auth/login`, { method: "POST", credentials: "include", headers: withLanguage({ "Content-Type": "application/json" }), body: JSON.stringify({ username, password }) });
  const body = await response.json() as SessionResponse | MfaChallenge | ApiError;
  if (!response.ok) throw new Error(errorMessage(body as ApiError, "Unable to sign in"));
  if ("mfaRequired" in body) return body;
  if (!("accessToken" in body)) throw new Error("Unable to sign in");
  const session = { token: body.accessToken, user: body.user };
  saveSession(session);
  return session;
}

export async function verifyMfaLogin(challengeToken: string, code: string): Promise<Session> {
  const response = await fetch(`${apiUrl}/api/v2/auth/2fa/verify-login`, {
    method: "POST",
    credentials: "include",
    headers: withLanguage({ "Content-Type": "application/json" }),
    body: JSON.stringify({ challengeToken, code }),
  });
  const body = await response.json() as SessionResponse | ApiError;
  if (!response.ok || !("accessToken" in body)) throw new Error(errorMessage(body as ApiError, "Unable to verify the security code"));
  const session = { token: body.accessToken, user: body.user };
  saveSession(session);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${apiUrl}/api/v2/auth/logout`, { method: "POST", credentials: "include", headers: withLanguage() });
  } finally {
    clearSession();
  }
}
