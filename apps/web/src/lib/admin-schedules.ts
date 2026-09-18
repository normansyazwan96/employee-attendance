import { clearSession, getSession } from "./auth";
import { apiUrl } from "./api";

export type AdminSchedule = { id: string; employeeId: string; employee: { name: string; username: string }; clientId: string | null; workDays: number[]; startTime: string; endTime: string; gracePeriodMinutes: number; isActive: boolean };
export type ScheduleInput = Omit<AdminSchedule, "id" | "employee" | "clientId">;

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1${path}`, { ...options, headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json", ...options?.headers } });
  if (response.status === 401) { clearSession(); throw new Error("Your session has expired. Please sign in again."); }
  const body = await response.json() as { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to update schedules");
  return body as T;
}

export async function getAdminSchedules(): Promise<AdminSchedule[]> { return (await request<{ schedules: AdminSchedule[] }>("/admin/schedules")).schedules; }
export async function upsertAdminSchedule(input: ScheduleInput): Promise<AdminSchedule> { return (await request<{ schedule: AdminSchedule }>("/admin/schedules", { method: "PUT", body: JSON.stringify(input) })).schedule; }
