import { clearSession, getSession } from "./auth";
import { apiUrl } from "./api";

export type Profile = { id: string; username: string; role: "EMPLOYEE" | "ADMIN" | "DEV_ADMIN"; displayName: string | null; firstName: string; lastName: string; mustChangePassword: boolean };
export type ProfileInput = { username: string; displayName: string | null; firstName?: string; lastName?: string; currentPassword?: string; newPassword?: string };
export type ProfileUpdate = { profile: Profile; token: string };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}${path}`, { ...options, headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json() as { error?: string };
  if (response.status === 401) { clearSession(); throw new Error("Your session has expired. Please sign in again."); }
  if (!response.ok) throw new Error(body.error ?? "Unable to update profile");
  return body as T;
}

export async function getProfile(): Promise<Profile> { return (await request<{ profile: Profile }>("/api/v1/profile")).profile; }
export async function updateProfile(input: ProfileInput): Promise<ProfileUpdate> { return request<ProfileUpdate>("/api/v1/profile", { method: "PATCH", body: JSON.stringify(input) }); }
