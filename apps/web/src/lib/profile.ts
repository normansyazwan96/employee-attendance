import { authenticatedFetch } from "./auth";

export type Profile = { id: string; username: string; email: string | null; role: "EMPLOYEE" | "ADMIN" | "MANAGER" | "GLOBAL_ADMIN" | "DEV_ADMIN"; displayName: string | null; firstName: string; lastName: string; mustChangePassword: boolean; mfaEnabled: boolean };
export type ProfileInput = { username: string; email: string | null; displayName: string | null; firstName?: string; lastName?: string; currentPassword?: string; newPassword?: string };
export type ProfileUpdate = { profile: Profile; token: string };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, { ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to update profile");
  return body as T;
}

export async function getProfile(): Promise<Profile> { return (await request<{ profile: Profile }>("/api/v1/profile")).profile; }
export async function updateProfile(input: ProfileInput): Promise<ProfileUpdate> { return request<ProfileUpdate>("/api/v1/profile", { method: "PATCH", body: JSON.stringify(input) }); }
