import { authenticatedFetch } from "./auth";

export type CorrectionRequest = { id: string; reason: string; note: string | null; status: string; createdAt: string; employee?: { firstName: string; lastName: string; user: { username: string } }; timesheetDay: { id: string; workDate: string; firstClockInAt: string | null; lastClockOutAt: string | null } };
export type LeaveRequest = { id: string; startDate: string; endDate: string; requestedMinutes: number; reason: string | null; status: string; employee?: { firstName: string; lastName: string; user: { username: string } }; leaveType: { id: string; code: string; name: string; isPaid: boolean } };
export type LeaveBalance = { id: string; year: number; entitledMinutes: number; usedMinutes: number; pendingMinutes: number; leaveType: LeaveRequest["leaveType"] };

async function checked<T>(responseOrPromise: Response | Promise<Response>): Promise<T> {
  const response = await responseOrPromise;
  if (response.ok && response.status === 204) return undefined as T;
  const text = await response.text();
  const body = (text ? JSON.parse(text) : {}) as T & { error?: { message?: string } | string };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : body.error?.message ?? "Request failed");
  return body;
}

export async function getApprovalInbox(): Promise<{ corrections: CorrectionRequest[]; leave: LeaveRequest[] }> { return checked(authenticatedFetch("/api/v2/workforce/approvals")); }
export async function reviewCorrection(id: string, decision: "APPROVED" | "REJECTED", note?: string): Promise<void> { await checked(authenticatedFetch(`/api/v2/workforce/corrections/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note }) })); }
export async function reviewLeave(id: string, decision: "APPROVED" | "REJECTED", note?: string): Promise<void> { await checked(authenticatedFetch(`/api/v2/workforce/leave-requests/${id}/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, note }) })); }
export async function getMyLeave(): Promise<{ types: LeaveRequest["leaveType"][]; balances: LeaveBalance[]; requests: LeaveRequest[] }> { return checked(authenticatedFetch("/api/v2/leave")); }
export async function createLeaveRequest(input: { leaveTypeId: string; startDate: string; endDate: string; requestedMinutes: number; reason?: string }): Promise<LeaveRequest> { const body = await checked<{ data: LeaveRequest }>(authenticatedFetch("/api/v2/leave/requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); return body.data; }
export async function cancelLeaveRequest(id: string): Promise<void> { await checked(authenticatedFetch(`/api/v2/leave/requests/${id}/cancel`, { method: "POST" })); }
export async function getMyCorrections(): Promise<CorrectionRequest[]> { const body = await checked<{ data: CorrectionRequest[] }>(authenticatedFetch("/api/v2/corrections")); return body.data; }
export async function createCorrection(input: { timesheetDayId: string; reason: string; note?: string; clockInAt: string | null; clockOutAt: string | null }): Promise<CorrectionRequest> { const body = await checked<{ data: CorrectionRequest }>(authenticatedFetch("/api/v2/corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) })); return body.data; }
