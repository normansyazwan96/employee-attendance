import { getSession } from "./auth";
import type { Attendance } from "./attendance";
import { apiUrl } from "./api";

export type AdminAttendance = Attendance & { employee: { id: string; name: string; username: string } };

export type AttendanceFilters = { from?: string; to?: string; page?: number; pageSize?: number };
export type AttendancePage = { attendance: AdminAttendance[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } };
export async function getAdminAttendance(filters: AttendanceFilters = {}): Promise<AttendancePage> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string | number] => entry[1] !== undefined).map(([key, value]) => [key, String(value)]));
  const response = await fetch(`${apiUrl}/api/v1/admin/attendance${query.toString() ? `?${query}` : ""}`, { headers: { Authorization: `Bearer ${session.token}` } });
  const body = await response.json() as Partial<AttendancePage> & { error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to load attendance");
  return { attendance: body.attendance ?? [], pagination: body.pagination ?? { page: 1, pageSize: 25, total: 0, totalPages: 0 } };
}

export async function exportAdminAttendance(filters: Pick<AttendanceFilters, "from" | "to"> = {}): Promise<void> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const query = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => Boolean(entry[1])));
  const response = await fetch(`${apiUrl}/api/v1/admin/attendance/export${query.toString() ? `?${query}` : ""}`, { headers: { Authorization: `Bearer ${session.token}` } });
  if (!response.ok) { const body = await response.json() as { error?: string }; throw new Error(body.error ?? "Unable to export attendance"); }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = "attendance-export.csv";
  link.click();
  URL.revokeObjectURL(link.href);
}
