import { authenticatedFetch } from "./auth";

type ApiError = { error?: { message?: string } | string };
async function dataRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authenticatedFetch(path, options);
  const body = await response.json() as { data?: T } & ApiError;
  if (!response.ok || body.data === undefined) throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? "Unable to load workforce data");
  return body.data;
}

export type WorkPolicy = { gracePeriodMinutes: number; defaultBreakMinutes: number; roundingIncrement: number; overtimeThreshold: number; maximumShiftMinutes: number; missedClockOutMinutes: number; maximumGpsAccuracy: number; exactGpsRetentionDays: number };
export type Manager = { id: string; user: { id: string; username: string; displayName: string | null; isActive: boolean }; reports: Array<{ userId: string }> };
export type Department = { id: string; name: string; code: string | null; isActive: boolean };
export type WorkforceEmployee = { id: string; firstName: string; lastName: string; employeeNumber: string | null; employmentStatus: "ACTIVE" | "ON_LEAVE" | "TERMINATED"; joinDate: string | null; terminationDate: string | null; departmentId: string | null; department: Department | null; user: { id: string; username: string; isActive: boolean } };
export type ShiftTemplate = { id: string; name: string; workDays: number[]; startTime: string; endTime: string; breakMinutes: number; gracePeriodMinutes: number; isOvernight: boolean; isActive: boolean };
export type ScheduleAssignment = { id: string; employeeId: string; shiftTemplateId: string; effectiveFrom: string; effectiveTo: string | null; employee: { firstName: string; lastName: string }; shiftTemplate: ShiftTemplate };
export type Holiday = { id: string; date: string; name: string; stateCode: string | null; isWorkingDayOverride: boolean };
export type WorkforceTimesheet = { id: string; workDate: string; state: "OPEN" | "COMPLETE" | "EXCEPTION" | "APPROVED" | "LOCKED"; regularMinutes: number; overtimeMinutes: number; breakMinutes: number; lateMinutes: number; earlyDepartureMinutes: number; leaveMinutes: number; paidLeaveMinutes: number; unpaidLeaveMinutes: number; isAbsent: boolean; exceptionCodes: string[]; employee: { firstName: string; lastName: string; employeeNumber: string | null; user: { username: string } } };

export const getWorkPolicy = (): Promise<WorkPolicy> => dataRequest("/api/v2/workforce/policy");
export const updateWorkPolicy = (policy: WorkPolicy): Promise<WorkPolicy> => dataRequest("/api/v2/workforce/policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) });
export const getManagers = (): Promise<Manager[]> => dataRequest("/api/v2/workforce/managers");
export const createManager = (input: { username: string; displayName: string; password: string }): Promise<Manager> => dataRequest("/api/v2/workforce/managers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export async function updateManagerStatus(userId: string, isActive: boolean): Promise<void> {
  const response = await authenticatedFetch(`/api/v2/workforce/managers/${userId}/status`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ isActive }) });
  if (!response.ok) { const body = await response.json() as ApiError; throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? "Unable to update manager"); }
}

export async function assignManagerReports(userId: string, employeeIds: string[]): Promise<void> {
  const response = await authenticatedFetch(`/api/v2/workforce/managers/${userId}/reports`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeIds }) });
  if (!response.ok) { const body = await response.json() as ApiError; throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? "Unable to assign employees"); }
}
export async function getDepartments(): Promise<Department[]> { const response = await authenticatedFetch("/api/v2/workforce/departments?limit=100"); const body = await response.json() as { data?: Department[]; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "Unable to load departments"); return body.data ?? []; }
export const createDepartment = (input: { name: string; code?: string | null; isActive: boolean }): Promise<Department> => dataRequest("/api/v2/workforce/departments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const getWorkforceEmployees = (): Promise<WorkforceEmployee[]> => dataRequest("/api/v2/workforce/employees");
export const getWorkforceTimesheets = (input: { from?: string; to?: string; cursor?: string; limit?: number } = {}): Promise<{ data: WorkforceTimesheet[]; nextCursor: string | null }> => {
  const query = new URLSearchParams();
  if (input.from) query.set("from", input.from); if (input.to) query.set("to", input.to); if (input.cursor) query.set("cursor", input.cursor); query.set("limit", String(input.limit ?? 100));
  return authenticatedFetch(`/api/v2/workforce/timesheets?${query}`).then(async (response) => { const body = await response.json() as { data?: WorkforceTimesheet[]; nextCursor?: string | null; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "Unable to load timesheets"); return { data: body.data ?? [], nextCursor: body.nextCursor ?? null }; });
};
export const updateWorkforceEmployee = (id: string, input: { employeeNumber?: string | null; employmentStatus: WorkforceEmployee["employmentStatus"]; joinDate?: string | null; terminationDate?: string | null; departmentId?: string | null }): Promise<WorkforceEmployee> => dataRequest(`/api/v2/workforce/employees/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const getShiftTemplates = (): Promise<ShiftTemplate[]> => dataRequest("/api/v2/workforce/shift-templates");
export const createShiftTemplate = (input: Omit<ShiftTemplate, "id" | "isOvernight">): Promise<ShiftTemplate> => dataRequest("/api/v2/workforce/shift-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export const getScheduleAssignments = (): Promise<ScheduleAssignment[]> => dataRequest("/api/v2/workforce/schedule-assignments");
export const createScheduleAssignment = (input: { employeeId: string; shiftTemplateId: string; effectiveFrom: string; effectiveTo?: string | null }): Promise<ScheduleAssignment> => dataRequest("/api/v2/workforce/schedule-assignments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export async function getHolidays(year?: number): Promise<Holiday[]> { const response = await authenticatedFetch(`/api/v2/workforce/holidays${year ? `?year=${year}` : ""}`); const body = await response.json() as { data?: Holiday[]; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "Unable to load holidays"); return body.data ?? []; }
export const createHoliday = (input: Omit<Holiday, "id">): Promise<Holiday> => dataRequest("/api/v2/workforce/holidays", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
export type MalaysiaHolidayCalendar = { data: Array<{ date: string; name: string; type: string }>; states: Record<string, string>; stateCode: string; importedCount: number; importedStateCount: number; disclaimer: string };
export async function getMalaysiaHolidayCalendar(year: number, stateCode?: string): Promise<MalaysiaHolidayCalendar> { const query = new URLSearchParams({ year: String(year) }); if (stateCode) query.set("stateCode", stateCode); const response = await authenticatedFetch(`/api/v2/workforce/holiday-calendar?${query}`); const body = await response.json() as MalaysiaHolidayCalendar & { error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "Unable to load Malaysian holiday calendar"); return body; }
export async function importMalaysiaHolidayCalendar(year: number): Promise<number> { const response = await authenticatedFetch("/api/v2/workforce/holiday-calendar/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ year }) }); const body = await response.json() as { imported?: number; error?: { message?: string } }; if (!response.ok) throw new Error(body.error?.message ?? "Unable to import holidays"); return body.imported ?? 0; }
