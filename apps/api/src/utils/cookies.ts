import { env } from "../config/env.js";

export const refreshCookieName = "attendance_refresh";

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function refreshCookie(value: string, maxAgeSeconds: number): string {
  const secure = env.APP_ENV === "production" || env.APP_ENV === "staging" ? "; Secure" : "";
  return `${refreshCookieName}=${encodeURIComponent(value)}; HttpOnly; Path=/api/v2/auth; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

export function clearRefreshCookie(): string {
  return refreshCookie("", 0);
}
