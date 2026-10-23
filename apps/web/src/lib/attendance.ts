import { authenticatedFetch } from "./auth";

export type ScheduleStatus = "ON_TIME" | "LATE" | "NOT_SCHEDULED" | "NO_SCHEDULE" | "MISSED_CLOCK_OUT";
export type Attendance = { id: string; workDate: string; clockInAt: string; clockOutAt: string | null; totalWorkingHours?: number; overtimeHours?: number; status: "CLOCKED_IN" | "CLOCKED_OUT"; scheduleStatus?: ScheduleStatus };
export type Location = { latitude: number; longitude: number; accuracy: number };
export type LocationStatus = { valid: boolean; reason?: string; worksite?: { id: string; name: string; distanceMeters: number; radiusMeters: number } };
export type AttendanceEvent = { id: string; type: "CLOCK_IN" | "CLOCK_OUT" | "BREAK_START" | "BREAK_END"; occurredAt: string; workDate: string };
export type TimesheetDay = { id: string; workDate: string; state: "OPEN" | "COMPLETE" | "EXCEPTION" | "APPROVED" | "LOCKED"; firstClockInAt: string | null; lastClockOutAt: string | null; regularMinutes: number; overtimeMinutes: number; breakMinutes: number; leaveMinutes: number; exceptionCodes: string[] };
export type ScheduleAssignment = { effectiveFrom: string; effectiveTo: string | null; shiftTemplate: { name: string; workDays: number[]; startTime: string; endTime: string; isOvernight: boolean } };

async function request(path: string, method = "GET", location?: Location): Promise<Attendance | null> {
  const response = await authenticatedFetch(`/api/v1${path}`, { method, headers: { ...(location ? { "Content-Type": "application/json" } : {}) }, ...(location ? { body: JSON.stringify({ location }) } : {}) });
  const body = await response.json() as { attendance?: Attendance; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to update attendance");
  return body.attendance ?? null;
}

async function eventRequest(action: "clock-in" | "clock-out" | "break-start" | "break-end", location: Location): Promise<Attendance> {
  const pendingKey = `attendance.pending.${action}`;
  const idempotencyKey = sessionStorage.getItem(pendingKey) ?? crypto.randomUUID();
  sessionStorage.setItem(pendingKey, idempotencyKey);
  const response = await authenticatedFetch(`/api/v2/attendance/events/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ location }),
  });
  const body = await response.json() as { attendance?: Attendance; error?: string | { message?: string } };
  if (!response.ok || !body.attendance) {
    const message = typeof body.error === "string" ? body.error : body.error?.message;
    throw new Error(message ?? "Unable to update attendance");
  }
  sessionStorage.removeItem(pendingKey);
  return body.attendance;
}

export async function getTodayAttendance(): Promise<Attendance | null> { return request("/attendance/today"); }
export async function getAttendanceHistory(): Promise<Attendance[]> {
  const response = await authenticatedFetch("/api/v1/attendance/history");
  const body = await response.json() as { attendance?: Attendance[]; error?: string };
  if (!response.ok) throw new Error(body.error ?? "Unable to load attendance history");
  return body.attendance ?? [];
}
export async function getLocationStatus(location: Location): Promise<LocationStatus> {
  const response = await authenticatedFetch("/api/v1/attendance/location-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location }) });
  const body = await response.json() as { location?: LocationStatus; error?: string };
  if (!response.ok || !body.location) throw new Error(body.error ?? "Unable to validate location");
  return body.location;
}
export async function clockIn(location: Location): Promise<Attendance> { return eventRequest("clock-in", location); }
export async function clockOut(location: Location): Promise<Attendance> { return eventRequest("clock-out", location); }
export async function startBreak(location: Location): Promise<Attendance> { return eventRequest("break-start", location); }
export async function endBreak(location: Location): Promise<Attendance> { return eventRequest("break-end", location); }
export async function getTodayTimesheet(): Promise<{ timesheet: TimesheetDay | null; events: AttendanceEvent[] }> {
  const response = await authenticatedFetch("/api/v2/attendance/today");
  const body = await response.json() as { timesheet?: TimesheetDay | null; events?: AttendanceEvent[]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load today's timesheet");
  return { timesheet: body.timesheet ?? null, events: body.events ?? [] };
}
export async function getMyTimesheets(from?: string, to?: string): Promise<TimesheetDay[]> {
  const query = new URLSearchParams(); if (from) query.set("from", from); if (to) query.set("to", to);
  const response = await authenticatedFetch(`/api/v2/attendance/timesheets?${query}`);
  const body = await response.json() as { data?: TimesheetDay[]; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load timesheets");
  return body.data ?? [];
}
export async function getMySchedule(): Promise<ScheduleAssignment | null> {
  const response = await authenticatedFetch("/api/v2/attendance/schedule");
  const body = await response.json() as { data?: ScheduleAssignment | null; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message ?? "Unable to load schedule");
  return body.data ?? null;
}
