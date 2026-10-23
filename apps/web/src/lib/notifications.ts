import { authenticatedFetch } from "./auth";

export type Notification = { id: string; type: string; title: string; message: string; entityType: string | null; entityId: string | null; readAt: string | null; createdAt: string };

export async function getNotifications(): Promise<Notification[]> {
  const response = await authenticatedFetch("/api/v2/notifications");
  const body = await response.json() as { data?: Notification[]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load notifications");
  return body.data ?? [];
}

export async function markNotificationRead(id: string): Promise<void> {
  const response = await authenticatedFetch(`/api/v2/notifications/${id}/read`, { method: "POST" });
  if (!response.ok) throw new Error("Unable to mark notification as read");
}
