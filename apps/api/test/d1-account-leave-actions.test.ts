import { Role } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userFindFirst: vi.fn(),
  userUpdate: vi.fn(),
  employeeFindUnique: vi.fn(),
  leaveTypeFindFirst: vi.fn(),
  leaveRequestFindFirst: vi.fn(),
  leaveRequestCreate: vi.fn(),
  leaveRequestUpdateMany: vi.fn(),
  attendanceCorrectionFindFirst: vi.fn(),
  attendanceCorrectionCreate: vi.fn(),
  attendanceCorrectionUpdateMany: vi.fn(),
  leaveBalanceUpsert: vi.fn(),
  leaveBalanceUpdate: vi.fn(),
  leaveBalanceUpdateMany: vi.fn(),
  payPeriodFindFirst: vi.fn(),
  scheduleAssignmentFindMany: vi.fn(),
  employeeScheduleFindUnique: vi.fn(),
  holidayFindMany: vi.fn(),
  malaysiaHolidayFindMany: vi.fn(),
  attendanceEventFindFirst: vi.fn(),
  attendanceEventCreate: vi.fn(),
  attendanceRecordUpsert: vi.fn(),
  clientFindUnique: vi.fn(),
  workPolicyFindUnique: vi.fn(),
  timesheetDayFindMany: vi.fn(),
  timesheetDayFindUnique: vi.fn(),
  timesheetDayCreate: vi.fn(),
  timesheetDayUpsert: vi.fn(),
  timesheetDayUpdate: vi.fn(),
  payrollAdjustmentCreate: vi.fn(),
  leaveAllocationCreate: vi.fn(),
  authSessionUpdateMany: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  recordAudit: vi.fn(),
  getAdminContext: vi.fn(),
  approvalRecipientIds: vi.fn(),
  notifyUsers: vi.fn(),
}));

vi.mock("../src/services/prisma.js", () => ({
  isD1Database: () => true,
  prisma: {
    user: { findUnique: mocks.userFindUnique, findFirst: mocks.userFindFirst, update: mocks.userUpdate },
    employee: { findUnique: mocks.employeeFindUnique },
    leaveType: { findFirst: mocks.leaveTypeFindFirst },
    leaveRequest: { findFirst: mocks.leaveRequestFindFirst, create: mocks.leaveRequestCreate, updateMany: mocks.leaveRequestUpdateMany },
    attendanceCorrection: { findFirst: mocks.attendanceCorrectionFindFirst, create: mocks.attendanceCorrectionCreate, updateMany: mocks.attendanceCorrectionUpdateMany },
    leaveBalance: { upsert: mocks.leaveBalanceUpsert, update: mocks.leaveBalanceUpdate, updateMany: mocks.leaveBalanceUpdateMany },
    payPeriod: { findFirst: mocks.payPeriodFindFirst },
    scheduleAssignment: { findMany: mocks.scheduleAssignmentFindMany },
    employeeSchedule: { findUnique: mocks.employeeScheduleFindUnique },
    holiday: { findMany: mocks.holidayFindMany },
    malaysiaHoliday: { findMany: mocks.malaysiaHolidayFindMany },
    attendanceEvent: { findFirst: mocks.attendanceEventFindFirst, create: mocks.attendanceEventCreate },
    attendanceRecord: { upsert: mocks.attendanceRecordUpsert },
    client: { findUnique: mocks.clientFindUnique },
    workPolicy: { findUnique: mocks.workPolicyFindUnique },
    timesheetDay: { findMany: mocks.timesheetDayFindMany, findUnique: mocks.timesheetDayFindUnique, create: mocks.timesheetDayCreate, upsert: mocks.timesheetDayUpsert, update: mocks.timesheetDayUpdate },
    payrollAdjustment: { create: mocks.payrollAdjustmentCreate },
    leaveAllocation: { create: mocks.leaveAllocationCreate },
    authSession: { updateMany: mocks.authSessionUpdateMany },
    auditLog: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));
vi.mock("../src/utils/password.js", () => ({ hashPassword: mocks.hashPassword, verifyPassword: mocks.verifyPassword }));
vi.mock("../src/utils/token.js", () => ({ createAccessToken: () => "next-access-token" }));
vi.mock("../src/services/auth-sessions.js", () => ({ accessTokenLifetimeSeconds: 900 }));
vi.mock("../src/services/audit.js", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("../src/services/admin-scope.js", () => ({ getAdminContext: mocks.getAdminContext }));
vi.mock("../src/services/notifications.js", () => ({ approvalRecipientIds: mocks.approvalRecipientIds, notifyUsers: mocks.notifyUsers }));

import { resetManagedAccountPassword } from "../src/controllers/admin-accounts.controller.js";
import { updateProfile } from "../src/controllers/profile.controller.js";
import { createClockExceptionV2, createLeaveRequestV2, reviewCorrectionV2, reviewLeaveRequestV2 } from "../src/controllers/requests-v2.controller.js";

function response(auth: { sub: string; role: Role; sid?: string }) {
  const result = {
    locals: { auth, requestId: "request-1" },
    statusCode: 200,
    body: undefined as unknown,
    ended: false,
    status: vi.fn((code: number) => { result.statusCode = code; return result; }),
    json: vi.fn((body: unknown) => { result.body = body; return result; }),
    end: vi.fn(() => { result.ended = true; return result; }),
  };
  return result;
}

const request = (body: unknown, params: Record<string, string> = {}) => ({ body, params, ip: "127.0.0.1", get: vi.fn() });

describe("D1 account and leave actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.mockImplementation(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
    mocks.hashPassword.mockResolvedValue("new-password-hash");
    mocks.recordAudit.mockResolvedValue(undefined);
    mocks.approvalRecipientIds.mockResolvedValue(["admin-1"]);
    mocks.notifyUsers.mockResolvedValue(undefined);
  });

  it("changes a temporary password using a batched transaction", async () => {
    const existing = { id: "employee-user", username: "employee", email: null, role: Role.EMPLOYEE, displayName: null, passwordHash: "old-hash", passwordVersion: 0, mustChangePassword: true, clientId: "client-1", employee: { firstName: "Aina", lastName: "Rahman" }, mfaCredential: null };
    const updated = { ...existing, passwordHash: "new-password-hash", passwordVersion: 1, mustChangePassword: false };
    mocks.userFindUnique.mockResolvedValue(existing);
    mocks.verifyPassword.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    mocks.userUpdate.mockResolvedValue(updated);
    mocks.authSessionUpdateMany.mockResolvedValue({ count: 0 });
    const res = response({ sub: existing.id, role: Role.EMPLOYEE, sid: "current-session" });

    await updateProfile(request({ username: "employee", email: null, displayName: null, firstName: "Aina", lastName: "Rahman", currentPassword: "Old!Pass1", newPassword: "New!Pass2" }) as never, res as never);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(typeof mocks.transaction.mock.calls[0][0]).not.toBe("function");
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ token: "next-access-token", profile: { mustChangePassword: false } });
  });

  it("resets an employee password using a batched transaction", async () => {
    const target = { id: "employee-user", username: "employee", role: Role.EMPLOYEE, isActive: true, displayName: null, clientId: "client-1", client: { name: "Client" } };
    mocks.getAdminContext.mockResolvedValue({ auth: { sub: "admin-1", role: Role.ADMIN }, clientId: "client-1", employeeUserWhere: { createdByUserId: "admin-1" } });
    mocks.userFindFirst.mockResolvedValue(target);
    mocks.userUpdate.mockResolvedValue(target);
    mocks.authSessionUpdateMany.mockResolvedValue({ count: 1 });
    const res = response({ sub: "admin-1", role: Role.ADMIN });

    await resetManagedAccountPassword(request({ password: "Reset!Pass2" }, { id: target.id }) as never, res as never);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(typeof mocks.transaction.mock.calls[0][0]).not.toBe("function");
    expect(res.statusCode).toBe(200);
  });

  it("creates a leave request and reserves its balance atomically", async () => {
    mocks.employeeFindUnique.mockResolvedValue({ id: "employee-1", userId: "employee-user", firstName: "Aina", lastName: "Rahman", user: { clientId: "client-1" } });
    mocks.leaveTypeFindFirst.mockResolvedValue({ id: "annual", defaultEntitlementMinutes: 8_000 });
    mocks.leaveRequestFindFirst.mockResolvedValue(null);
    mocks.leaveBalanceUpsert.mockResolvedValue({ id: "balance-1", entitledMinutes: 8_000, usedMinutes: 0, pendingMinutes: 0 });
    mocks.leaveBalanceUpdate.mockResolvedValue({ id: "balance-1", pendingMinutes: 480 });
    mocks.leaveRequestCreate.mockResolvedValue({ id: "leave-1", startDate: "2026-11-02", endDate: "2026-11-02" });
    const res = response({ sub: "employee-user", role: Role.EMPLOYEE });

    await createLeaveRequestV2(request({ leaveTypeId: "annual", startDate: "2026-11-02", endDate: "2026-11-02", requestedMinutes: 480, reason: "Family appointment" }) as never, res as never);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(typeof mocks.transaction.mock.calls[0][0]).not.toBe("function");
    expect(res.statusCode).toBe(201);
  });

  it("creates a server-timed GPS clock exception without creating an attendance event", async () => {
    mocks.employeeFindUnique.mockResolvedValue({ id: "employee-1", userId: "employee-user", firstName: "Aina", lastName: "Rahman", employmentStatus: "ACTIVE", user: { clientId: "client-1" } });
    mocks.timesheetDayFindUnique.mockResolvedValue(null);
    mocks.attendanceCorrectionFindFirst.mockResolvedValue(null);
    mocks.timesheetDayCreate.mockResolvedValue({ id: "timesheet-1" });
    mocks.attendanceCorrectionCreate.mockResolvedValue({ id: "correction-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    const res = response({ sub: "employee-user", role: Role.EMPLOYEE });

    await createClockExceptionV2(request({ action: "CLOCK_IN", reasonCode: "GPS_TIMEOUT", note: "GPS kept loading", diagnostics: { attemptCount: 2, browserErrorCode: 3 } }) as never, res as never);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(mocks.attendanceCorrectionCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ requestedValues: expect.objectContaining({ requestKind: "GPS_CLOCK_EXCEPTION", action: "CLOCK_IN", reasonCode: "GPS_TIMEOUT", serverReceivedAt: expect.any(String) }) }) }));
    expect(mocks.attendanceEventCreate).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(201);
  });

  it("rejects an attendance correction using a batched D1 transaction", async () => {
    const correction = { id: "correction-1", employeeId: "employee-1", timesheetDayId: "timesheet-1", reason: "Wrong clock-out", originalValues: {}, requestedValues: {}, status: "PENDING", timesheetDay: { id: "timesheet-1", workDate: "2026-10-19", state: "COMPLETE", payPeriodId: null, breakMinutes: 60, regularMinutes: 480, overtimeMinutes: 0 }, employee: { userId: "employee-user", user: { clientId: "client-1" } } };
    mocks.getAdminContext.mockResolvedValue({ auth: { sub: "admin-1", role: Role.ADMIN }, clientId: "client-1", employeeUserWhere: { createdByUserId: "admin-1" } });
    mocks.attendanceCorrectionFindFirst.mockResolvedValue(correction);
    mocks.attendanceCorrectionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    const res = response({ sub: "admin-1", role: Role.ADMIN });

    await reviewCorrectionV2(request({ decision: "REJECTED" }, { id: correction.id }) as never, res as never);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(typeof mocks.transaction.mock.calls[0][0]).not.toBe("function");
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it("approves an attendance correction and updates its timesheet in a batched D1 transaction", async () => {
    const correction = { id: "correction-2", employeeId: "employee-1", timesheetDayId: "timesheet-1", reason: "Wrong clock-out", originalValues: { firstClockInAt: "2026-10-19T01:00:00.000Z", lastClockOutAt: "2026-10-19T08:00:00.000Z" }, requestedValues: { firstClockInAt: "2026-10-19T01:00:00.000Z", lastClockOutAt: "2026-10-19T10:00:00.000Z" }, status: "PENDING", timesheetDay: { id: "timesheet-1", workDate: "2026-10-19", state: "EXCEPTION", payPeriodId: null, breakMinutes: 60, regularMinutes: 360, overtimeMinutes: 0 }, employee: { userId: "employee-user", user: { clientId: "client-1" } } };
    mocks.getAdminContext.mockResolvedValue({ auth: { sub: "admin-1", role: Role.ADMIN }, clientId: "client-1", employeeUserWhere: { createdByUserId: "admin-1" } });
    mocks.attendanceCorrectionFindFirst.mockResolvedValue(correction);
    mocks.workPolicyFindUnique.mockResolvedValue({ overtimeThreshold: 480 });
    mocks.attendanceCorrectionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.timesheetDayUpdate.mockResolvedValue({ id: "timesheet-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    const res = response({ sub: "admin-1", role: Role.ADMIN });

    await reviewCorrectionV2(request({ decision: "APPROVED" }, { id: correction.id }) as never, res as never);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(typeof mocks.transaction.mock.calls[0][0]).not.toBe("function");
    expect(mocks.timesheetDayUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ regularMinutes: 480, overtimeMinutes: 0 }) }));
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it("approves a GPS clock exception as an administrator adjustment event", async () => {
    const receivedAt = "2026-10-19T01:00:00.000Z";
    const correction = { id: "correction-gps", employeeId: "employee-1", timesheetDayId: "timesheet-1", reason: "Clock-in blocked: GPS_TIMEOUT", originalValues: { firstClockInAt: null, lastClockOutAt: null }, requestedValues: { firstClockInAt: receivedAt, lastClockOutAt: null, requestKind: "GPS_CLOCK_EXCEPTION", action: "CLOCK_IN", reasonCode: "GPS_TIMEOUT", serverReceivedAt: receivedAt, diagnostics: { attemptCount: 2 } }, status: "PENDING", timesheetDay: { id: "timesheet-1", workDate: "2026-10-19", state: "EXCEPTION", payPeriodId: null, breakMinutes: 0, regularMinutes: 0, overtimeMinutes: 0, firstClockInAt: null, lastClockOutAt: null, exceptionCodes: ["GPS_CLOCK_REQUEST_PENDING"] }, employee: { userId: "employee-user", user: { clientId: "client-1" } } };
    mocks.getAdminContext.mockResolvedValue({ auth: { sub: "admin-1", role: Role.ADMIN }, clientId: "client-1", employeeUserWhere: { clientId: "client-1" } });
    mocks.attendanceCorrectionFindFirst.mockResolvedValue(correction);
    mocks.workPolicyFindUnique.mockResolvedValue({ overtimeThreshold: 480 });
    mocks.attendanceCorrectionUpdateMany.mockResolvedValue({ count: 1 });
    mocks.attendanceEventCreate.mockResolvedValue({ id: "event-1" });
    mocks.attendanceRecordUpsert.mockResolvedValue({ id: "attendance-1" });
    mocks.timesheetDayUpdate.mockResolvedValue({ id: "timesheet-1" });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    const res = response({ sub: "admin-1", role: Role.ADMIN });

    await reviewCorrectionV2(request({ decision: "APPROVED" }, { id: correction.id }) as never, res as never);

    expect(mocks.attendanceEventCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ source: "ADMIN_ADJUSTMENT", occurredAt: new Date(receivedAt), idempotencyKey: `correction:${correction.id}` }) }));
    expect(mocks.attendanceRecordUpsert).toHaveBeenCalledOnce();
    expect(mocks.timesheetDayUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ state: "OPEN", exceptionCodes: [] }) }));
    expect(res.statusCode).toBe(204);
  });

  it("rejects leave and releases the pending balance atomically", async () => {
    const leave = { id: "leave-1", clientId: "client-1", employeeId: "employee-1", leaveTypeId: "annual", startDate: "2026-11-02", endDate: "2026-11-02", requestedMinutes: 480, status: "PENDING", employee: { userId: "employee-user", user: { clientId: "client-1" } }, leaveType: { name: "Annual Leave", isPaid: true } };
    mocks.getAdminContext.mockResolvedValue({ auth: { sub: "admin-1", role: Role.ADMIN }, clientId: "client-1", employeeUserWhere: { createdByUserId: "admin-1" } });
    mocks.leaveRequestFindFirst.mockResolvedValue(leave);
    mocks.leaveRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.leaveBalanceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    const res = response({ sub: "admin-1", role: Role.ADMIN });

    await reviewLeaveRequestV2(request({ decision: "REJECTED" }, { id: leave.id }) as never, res as never);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(typeof mocks.transaction.mock.calls[0][0]).not.toBe("function");
    expect(res.statusCode).toBe(204);
    expect(res.ended).toBe(true);
  });

  it("approves leave and creates its timesheet allocation atomically", async () => {
    const leave = { id: "leave-2", clientId: "client-1", employeeId: "employee-1", leaveTypeId: "annual", startDate: "2026-11-02", endDate: "2026-11-02", requestedMinutes: 480, status: "PENDING", employee: { userId: "employee-user", user: { clientId: "client-1" } }, leaveType: { name: "Annual Leave", isPaid: true } };
    mocks.getAdminContext.mockResolvedValue({ auth: { sub: "admin-1", role: Role.ADMIN }, clientId: "client-1", employeeUserWhere: { createdByUserId: "admin-1" } });
    mocks.leaveRequestFindFirst.mockResolvedValue(leave);
    mocks.payPeriodFindFirst.mockResolvedValue(null);
    mocks.scheduleAssignmentFindMany.mockResolvedValue([]);
    mocks.employeeScheduleFindUnique.mockResolvedValue(null);
    mocks.holidayFindMany.mockResolvedValue([]);
    mocks.malaysiaHolidayFindMany.mockResolvedValue([]);
    mocks.attendanceEventFindFirst.mockResolvedValue(null);
    mocks.clientFindUnique.mockResolvedValue({ stateCode: "10" });
    mocks.workPolicyFindUnique.mockResolvedValue({ overtimeThreshold: 480, defaultBreakMinutes: 60 });
    mocks.timesheetDayFindMany.mockResolvedValue([]);
    mocks.timesheetDayUpsert.mockResolvedValue({ id: "timesheet-1" });
    mocks.leaveAllocationCreate.mockResolvedValue({ id: "allocation-1" });
    mocks.leaveRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.leaveBalanceUpdateMany.mockResolvedValue({ count: 1 });
    mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
    const res = response({ sub: "admin-1", role: Role.ADMIN });

    await reviewLeaveRequestV2(request({ decision: "APPROVED" }, { id: leave.id }) as never, res as never);

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(typeof mocks.transaction.mock.calls[0][0]).not.toBe("function");
    expect(mocks.timesheetDayUpsert).toHaveBeenCalledOnce();
    expect(mocks.leaveAllocationCreate).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(204);
  });
});
