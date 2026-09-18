import { clearSession, getSession } from "./auth";
import { apiUrl } from "./api";

export type ScheduleStatus = "ON_TIME" | "LATE" | "NOT_SCHEDULED" | "NO_SCHEDULE" | "MISSED_CLOCK_OUT";
export type Attendance = { id: string; workDate: string; clockInAt: string; clockOutAt: string | null; totalWorkingHours?: number; overtimeHours?: number; status: "CLOCKED_IN" | "CLOCKED_OUT"; scheduleStatus?: ScheduleStatus };
export type Location = { latitude: number; longitude: number; accuracy: number };
export type LocationStatus = { valid: boolean; reason?: string; worksite?: { id: string; name: string; distanceMeters: number; radiusMeters: number } };

async function request(path: string, method = "GET", location?: Location): Promise<Attendance | null> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1${path}`, { method, headers: { Authorization: `Bearer ${session.token}`, ...(location ? { "Content-Type": "application/json" } : {}) }, ...(location ? { body: JSON.stringify({ location }) } : {}) });
  const body = await response.json() as { attendance?: Attendance; error?: string };
  if (response.status === 401) { clearSession(); throw new Error("Your session has expired. Please sign in again."); }
  if (!response.ok) throw new Error(body.error ?? "Unable to update attendance");
  return body.attendance ?? null;
}

export async function getTodayAttendance(): Promise<Attendance | null> { return request("/attendance/today"); }
export async function getAttendanceHistory(): Promise<Attendance[]> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1/attendance/history`, { headers: { Authorization: `Bearer ${session.token}` } });
  const body = await response.json() as { attendance?: Attendance[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to load attendance history");
  return body.attendance ?? [];
}
export async function getLocationStatus(location: Location): Promise<LocationStatus> {
  const session = getSession();
  if (!session) throw new Error("Please sign in again");
  const response = await fetch(`${apiUrl}/api/v1/attendance/location-status`, { method: "POST", headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ location }) });
  const body = await response.json() as { location?: LocationStatus; error?: string };
  if (!response.ok || !body.location) throw new Error(body.error ?? "Unable to validate location");
  return body.location;
}
export async function clockIn(location: Location): Promise<Attendance> { return (await request("/attendance/clock-in", "POST", location))!; }
export async function clockOut(location: Location): Promise<Attendance> { return (await request("/attendance/clock-out", "POST", location))!; }
