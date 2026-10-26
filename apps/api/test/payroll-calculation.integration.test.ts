import { EpfContributionCategory, MembershipRole, PayType, PayrollCalculationBasis, PayrollComponentType, Role, SocsoContributionCategory, TimesheetState } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app } from "../src/app.js";
import { env } from "../src/config/env.js";
import { configurePayrollExport, processPayrollExport } from "../src/services/payroll-export.js";
import { prisma } from "../src/services/prisma.js";
import { createAccessToken } from "../src/utils/token.js";

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const adminUsername = `calc-admin-${suffix}`;
const approverUsername = `calc-approver-${suffix}`;
const employeeUsername = `calc-employee-${suffix}`;
let clientId = "";
let adminId = "";
let approverAdminId = "";
let employeeUserId = "";
let employeeId = "";
let payPeriodId = "";
let advanceAssignmentId = "";
let lockedCalculatedPaySen = 0;
const sessionIds = new Map<string, string>();

function auth(): string {
  return `Bearer ${createAccessToken({ sub: adminId, username: adminUsername, role: Role.ADMIN, sid: sessionIds.get(adminId) })}`;
}

function employeeAuth(): string {
  return `Bearer ${createAccessToken({ sub: employeeUserId, username: employeeUsername, role: Role.EMPLOYEE, sid: sessionIds.get(employeeUserId) })}`;
}

function approverAuth(): string {
  return `Bearer ${createAccessToken({ sub: approverAdminId, username: approverUsername, role: Role.ADMIN, sid: sessionIds.get(approverAdminId) })}`;
}

beforeAll(async () => {
  const client = await prisma.client.create({ data: { name: `Calculation tenant ${suffix}` } });
  clientId = client.id;
  const admin = await prisma.user.create({ data: { username: adminUsername, passwordHash: "test", role: Role.ADMIN, clientId } });
  adminId = admin.id;
  await prisma.organizationMembership.create({ data: { userId: adminId, clientId, role: MembershipRole.ADMIN, canManagePayroll: true } });
  const approver = await prisma.user.create({ data: { username: approverUsername, passwordHash: "test", role: Role.ADMIN, clientId } });
  approverAdminId = approver.id;
  await prisma.organizationMembership.create({ data: { userId: approverAdminId, clientId, role: MembershipRole.ADMIN, canManagePayroll: true } });
  const employeeUser = await prisma.user.create({
    data: {
      username: employeeUsername,
      email: `payroll-${suffix}@example.com`,
      passwordHash: "test",
      role: Role.EMPLOYEE,
      clientId,
      createdByUserId: adminId,
      employee: { create: { firstName: "Payroll", lastName: "Calculation", employeeNumber: `E-${suffix}` } },
      memberships: { create: { clientId, role: MembershipRole.EMPLOYEE } },
    },
  });
  employeeUserId = employeeUser.id;
  employeeId = (await prisma.employee.findUniqueOrThrow({ where: { userId: employeeUserId } })).id;
  const sessionUserIds = [adminId, approverAdminId, employeeUserId];
  const sessions = await Promise.all(sessionUserIds.map((userId) => prisma.authSession.create({
    data: { userId, refreshTokenHash: `test-${suffix}-${userId}`, familyId: `family-${suffix}-${userId}`, expiresAt: new Date(Date.now() + 3_600_000) },
  })));
  sessions.forEach((session) => sessionIds.set(session.userId, session.id));
  await prisma.payrollSettings.create({ data: { clientId, statutoryContributionsEnabled: true } });
  await prisma.payProfile.create({ data: { employeeId, payType: PayType.MONTHLY, baseRateSen: 310_000, normalDailyMinutes: 480, normalWeeklyMinutes: 2_700, overtimeEligible: true, effectiveFrom: "2026-01-01", createdByUserId: adminId } });
  await prisma.employeeStatutoryProfile.create({ data: { employeeId, epfCategory: EpfContributionCategory.EXEMPT, socsoCategory: SocsoContributionCategory.EXEMPT, eisEligible: false, effectiveFrom: "2026-01-01", createdByUserId: adminId } });
  await prisma.employeeSchedule.create({ data: { employeeId, workDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "18:00" } });
  await prisma.timesheetDay.create({ data: { clientId, employeeId, workDate: "2026-10-01", state: TimesheetState.COMPLETE, regularMinutes: 480, overtimeMinutes: 60 } });
  const component = await prisma.payrollComponent.create({ data: { clientId, code: `ADV-${suffix}`, name: "Advance repayment", type: PayrollComponentType.ADVANCE_REPAYMENT, calculationBasis: PayrollCalculationBasis.FIXED_AMOUNT, defaultAmountSen: 2_500 } });
  const assignment = await prisma.employeePayComponent.create({ data: { clientId, employeeId, payrollComponentId: component.id, amountSen: 2_500, totalAmountSen: 10_000, outstandingAmountSen: 10_000, effectiveFrom: "2026-10-01", consentReference: `CONSENT-${suffix}`, createdByUserId: adminId } });
  advanceAssignmentId = assignment.id;
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER "AuditLog_immutable_delete"');
  await prisma.$executeRawUnsafe('ALTER TABLE "PayrollMonetaryAdjustment" DISABLE TRIGGER "PayrollMonetaryAdjustment_immutable_update"');
  await prisma.$executeRawUnsafe('ALTER TABLE "PayrollMonetaryAdjustment" DISABLE TRIGGER "PayrollMonetaryAdjustment_immutable_delete"');
  await prisma.$executeRawUnsafe('ALTER TABLE "PayrollMonetaryAdjustmentDecision" DISABLE TRIGGER "PayrollMonetaryAdjustmentDecision_immutable_update"');
  await prisma.$executeRawUnsafe('ALTER TABLE "PayrollMonetaryAdjustmentDecision" DISABLE TRIGGER "PayrollMonetaryAdjustmentDecision_immutable_delete"');
  await prisma.$executeRawUnsafe('ALTER TABLE "PayrollStatementDelivery" DISABLE TRIGGER "PayrollStatementDelivery_immutable_update"');
  await prisma.$executeRawUnsafe('ALTER TABLE "PayrollStatementDelivery" DISABLE TRIGGER "PayrollStatementDelivery_immutable_delete"');
  try {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [adminId, approverAdminId] } } });
    await prisma.payrollMonetaryAdjustmentDecision.deleteMany({ where: { clientId } });
    await prisma.payrollStatementDelivery.deleteMany({ where: { clientId } });
    await prisma.payrollMonetaryAdjustment.deleteMany({ where: { clientId } });
    await prisma.payrollCalculationRun.deleteMany({ where: { clientId } });
    await prisma.user.deleteMany({ where: { id: { in: [employeeUserId, approverAdminId, adminId] } } });
    await prisma.client.deleteMany({ where: { id: clientId } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "PayrollStatementDelivery" ENABLE TRIGGER "PayrollStatementDelivery_immutable_update"');
    await prisma.$executeRawUnsafe('ALTER TABLE "PayrollStatementDelivery" ENABLE TRIGGER "PayrollStatementDelivery_immutable_delete"');
    await prisma.$executeRawUnsafe('ALTER TABLE "PayrollMonetaryAdjustmentDecision" ENABLE TRIGGER "PayrollMonetaryAdjustmentDecision_immutable_update"');
    await prisma.$executeRawUnsafe('ALTER TABLE "PayrollMonetaryAdjustmentDecision" ENABLE TRIGGER "PayrollMonetaryAdjustmentDecision_immutable_delete"');
    await prisma.$executeRawUnsafe('ALTER TABLE "PayrollMonetaryAdjustment" ENABLE TRIGGER "PayrollMonetaryAdjustment_immutable_update"');
    await prisma.$executeRawUnsafe('ALTER TABLE "PayrollMonetaryAdjustment" ENABLE TRIGGER "PayrollMonetaryAdjustment_immutable_delete"');
    await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER "AuditLog_immutable_delete"');
  }
  await prisma.$disconnect();
});

describe("payroll calculation workflow", () => {
  it("requires a successful calculation before review", async () => {
    const created = await request(app).post("/api/v2/payroll/pay-periods").set("Authorization", auth()).send({ name: "October 2026", startDate: "2026-10-01", endDate: "2026-10-31" });
    expect(created.status).toBe(201);
    payPeriodId = created.body.data.id;
    const review = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/transition`).set("Authorization", auth()).send({ action: "REVIEW" });
    expect(review.status).toBe(409);
    expect(review.body.error.code).toBe("PAYROLL_CALCULATION_REQUIRED");
  });

  it("calculates, reviews, approves, and locks an immutable result", async () => {
    const calculated = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/calculate`).set("Authorization", auth());
    expect(calculated.status).toBe(201);
    expect(calculated.body.data).toMatchObject({ version: 1, status: "DRAFT", expectedEmployeeCount: 1, warningCount: 3, blockingWarningCount: 0, totalDeductionsSen: 2_500 });
    expect(calculated.body.data.results).toHaveLength(1);
    expect(calculated.body.data.results[0].warnings).toEqual(["EIS_EXEMPT", "EPF_EXEMPT", "SOCSO_EXEMPT"]);
    lockedCalculatedPaySen = calculated.body.data.results[0].calculatedPaySen;
    expect(calculated.body.data.results[0].lines.some((line: { category: string }) => line.category === "ADVANCE_REPAYMENT")).toBe(true);

    const latest = await request(app).get(`/api/v2/payroll/pay-periods/${payPeriodId}/calculations/latest`).set("Authorization", auth());
    expect(latest.status).toBe(200);
    expect(latest.body.data.inputHash).toMatch(/^[a-f0-9]{64}$/);

    const unacknowledgedReview = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/transition`).set("Authorization", auth()).send({ action: "REVIEW" });
    expect(unacknowledgedReview.status).toBe(409);
    expect(unacknowledgedReview.body.error).toMatchObject({ code: "PAYROLL_WARNINGS_UNACKNOWLEDGED", details: { warnings: 3 } });

    for (const warningCode of calculated.body.data.results[0].warnings as string[]) {
      const acknowledged = await request(app)
        .post(`/api/v2/payroll/pay-periods/${payPeriodId}/calculations/latest/results/${calculated.body.data.results[0].id}/warnings/${warningCode}/acknowledge`)
        .set("Authorization", auth())
        .send({ note: `Reviewed ${warningCode} against the employee record` });
      expect(acknowledged.status).toBe(201);
      expect(acknowledged.body.data).toMatchObject({ warningCode, acknowledgedByUsername: adminUsername });
    }
    const validated = await request(app).get(`/api/v2/payroll/pay-periods/${payPeriodId}/calculations/latest`).set("Authorization", auth());
    expect(validated.body.data.results[0].warningAcknowledgements).toHaveLength(3);
    expect(await prisma.auditLog.count({ where: { actorUserId: adminId, action: "PAYROLL_WARNING_ACKNOWLEDGED" } })).toBe(3);

    const addedAfterCalculation = await prisma.user.create({
      data: {
        username: `late-payroll-${suffix}`,
        passwordHash: "test",
        role: Role.EMPLOYEE,
        clientId,
        createdByUserId: approverAdminId,
        employee: { create: { firstName: "Late", lastName: "Payroll", employeeNumber: `LATE-${suffix}` } },
      },
    });
    const incompleteReview = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/transition`).set("Authorization", auth()).send({ action: "REVIEW" });
    expect(incompleteReview.status).toBe(409);
    expect(incompleteReview.body.error).toMatchObject({ code: "PAYROLL_CALCULATION_INCOMPLETE", details: { expectedEmployees: 2, calculatedEmployees: 1, missingEmployees: 1 } });
    await prisma.user.delete({ where: { id: addedAfterCalculation.id } });

    for (const action of ["REVIEW", "REOPEN", "REVIEW", "APPROVE", "REOPEN", "REVIEW", "APPROVE", "LOCK"] as const) {
      const transitioned = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/transition`).set("Authorization", auth()).send({ action });
      expect(transitioned.status).toBe(200);
    }
    expect((await prisma.payrollCalculationRun.findFirstOrThrow({ where: { payPeriodId } })).status).toBe("LOCKED");
    expect((await prisma.employeePayComponent.findUniqueOrThrow({ where: { id: advanceAssignmentId } })).outstandingAmountSen).toBe(7_500);

    const secondLock = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/transition`).set("Authorization", auth()).send({ action: "LOCK" });
    expect(secondLock.status).toBe(409);
    expect((await prisma.employeePayComponent.findUniqueOrThrow({ where: { id: advanceAssignmentId } })).outstandingAmountSen).toBe(7_500);
  });

  it("requires two-person approval before immutable adjustments affect employee statements", async () => {
    const earning = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments`).set("Authorization", auth()).send({
      employeeId,
      direction: "EARNING",
      code: "BONUS",
      name: "Performance bonus",
      amountSen: 1_000,
      reason: "Approved October performance bonus",
    });
    expect(earning.status).toBe(201);
    expect(earning.body.data.status).toBe("PENDING");

    const beforeApproval = await request(app).get("/api/v2/payroll/my-statements").set("Authorization", employeeAuth());
    expect(beforeApproval.status).toBe(200);
    expect(beforeApproval.body.data[0]).toMatchObject({ adjustmentEarningsSen: 0, adjustmentDeductionsSen: 0, finalCalculatedPaySen: lockedCalculatedPaySen });
    expect(beforeApproval.body.data[0].adjustments).toHaveLength(0);

    const selfApproval = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments/${earning.body.data.id}/decision`).set("Authorization", auth()).send({ outcome: "APPROVED", note: "Attempted self approval" });
    expect(selfApproval.status).toBe(409);
    expect(selfApproval.body.error.code).toBe("SELF_APPROVAL_NOT_ALLOWED");

    const pending = await request(app).get(`/api/v2/payroll/adjustments/pending?payPeriodId=${payPeriodId}`).set("Authorization", approverAuth());
    expect(pending.status).toBe(200);
    expect(pending.body.data).toHaveLength(1);
    expect(pending.body.data[0]).toMatchObject({ id: earning.body.data.id, createdBy: { id: adminId } });

    const approvedEarning = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments/${earning.body.data.id}/decision`).set("Authorization", approverAuth()).send({ outcome: "APPROVED", note: "Checked against the approved bonus record" });
    expect(approvedEarning.status).toBe(201);
    expect(approvedEarning.body.data.outcome).toBe("APPROVED");

    const rejectedDeduction = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments`).set("Authorization", auth()).send({
      employeeId,
      direction: "DEDUCTION",
      code: "CORRECTION",
      name: "Calculation correction",
      amountSen: 500,
      reason: "Approved payroll calculation correction",
    });
    expect(rejectedDeduction.status).toBe(201);
    const rejected = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments/${rejectedDeduction.body.data.id}/decision`).set("Authorization", approverAuth()).send({ outcome: "REJECTED", note: "Supporting record was not sufficient" });
    expect(rejected.status).toBe(201);

    const deduction = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments`).set("Authorization", auth()).send({ employeeId, direction: "DEDUCTION", code: "ADJUSTMENT", name: "Approved correction", amountSen: 500, reason: "Corrected and supported payroll record" });
    expect(deduction.status).toBe(201);
    const approvedDeduction = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments/${deduction.body.data.id}/decision`).set("Authorization", approverAuth()).send({ outcome: "APPROVED", note: "Supporting record verified independently" });
    expect(approvedDeduction.status).toBe(201);

    const excessive = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments`).set("Authorization", auth()).send({
      employeeId,
      direction: "DEDUCTION",
      code: "TOO_MUCH",
      name: "Excessive deduction",
      amountSen: lockedCalculatedPaySen + 1_001,
      reason: "This deduction must be rejected",
    });
    expect(excessive.status).toBe(409);
    expect(excessive.body.error.code).toBe("ADJUSTMENT_EXCEEDS_PAY");

    const statements = await request(app).get("/api/v2/payroll/my-statements").set("Authorization", employeeAuth());
    expect(statements.status).toBe(200);
    expect(statements.body.data).toHaveLength(1);
    expect(statements.body.data[0]).toMatchObject({ adjustmentEarningsSen: 1_000, adjustmentDeductionsSen: 500, finalCalculatedPaySen: lockedCalculatedPaySen + 500 });
    expect(statements.body.data[0].adjustments).toHaveLength(2);
    expect(statements.body.data[0].employee.username).toBe(employeeUsername);

    const downloaded = await request(app).get(`/api/v2/payroll/my-statements/${payPeriodId}/download`).set("Authorization", employeeAuth()).set("Accept-Language", "ms");
    expect(downloaded.status).toBe(200);
    expect(downloaded.headers["content-type"]).toContain("text/html");
    expect(downloaded.text).toContain("Penyata pengiraan gaji");
    expect(downloaded.text).toContain("bukan bukti pembayaran");

    await expect(prisma.payrollMonetaryAdjustment.update({ where: { id: earning.body.data.id }, data: { amountSen: 2_000 } })).rejects.toThrow(/immutable/i);
    await expect(prisma.payrollMonetaryAdjustmentDecision.update({ where: { adjustmentId: earning.body.data.id }, data: { note: "Changed" } })).rejects.toThrow(/immutable/i);
    expect(await prisma.auditLog.findFirst({ where: { actorUserId: adminId, action: "PAYROLL_ADJUSTMENT_CREATED", entityId: earning.body.data.id } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { actorUserId: approverAdminId, action: "PAYROLL_ADJUSTMENT_APPROVED", entityId: earning.body.data.id } })).not.toBeNull();
    expect(await prisma.notification.findFirst({ where: { userId: employeeUserId, type: "PAYROLL_ADJUSTMENT_APPROVED", entityId: earning.body.data.id } })).not.toBeNull();
  });

  it("generates a real PDF and records emailed statement delivery", async () => {
    const pdf = await request(app).get(`/api/v2/payroll/my-statements/${payPeriodId}/download.pdf`).set("Authorization", employeeAuth()).set("Accept-Language", "en");
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain(".pdf");
    expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe("%PDF");

    const originalKey = env.RESEND_API_KEY;
    const originalFrom = env.EMAIL_FROM;
    env.RESEND_API_KEY = "test-resend-key";
    env.EMAIL_FROM = "attend+ <payroll@example.com>";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "resend-message-1" }), { status: 200, headers: { "Content-Type": "application/json" } }));
    try {
      const resultId = (await prisma.payrollCalculationResult.findFirstOrThrow({ where: { employeeId } })).id;
      const sent = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/statements/${resultId}/email`).set("Authorization", auth()).send({ language: "ms" });
      expect(sent.status).toBe(201);
      expect(sent.body.data).toMatchObject({ status: "SENT", providerMessageId: "resend-message-1", language: "ms" });
      const resendRequest = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { attachments: Array<{ filename: string; content: string }> };
      expect(resendRequest.attachments[0].filename).toMatch(/\.pdf$/);
      expect(Buffer.from(resendRequest.attachments[0].content, "base64").subarray(0, 4).toString()).toBe("%PDF");
      const deliveries = await request(app).get(`/api/v2/payroll/pay-periods/${payPeriodId}/statement-deliveries`).set("Authorization", auth());
      expect(deliveries.status).toBe(200);
      expect(deliveries.body.data[0]).toMatchObject({ status: "SENT", recipientEmail: `payroll-${suffix}@example.com` });
      await expect(prisma.payrollStatementDelivery.update({ where: { id: sent.body.data.id }, data: { language: "en" } })).rejects.toThrow(/immutable/i);
    } finally {
      fetchMock.mockRestore();
      env.RESEND_API_KEY = originalKey;
      env.EMAIL_FROM = originalFrom;
    }
  });

  it("exports one payroll calculation row per employee", async () => {
    await prisma.payrollCalculationRun.create({
      data: {
        clientId,
        payPeriodId,
        version: 2,
        status: "LOCKED",
        rulePackVersion: "decoy-run",
        inputHash: "0".repeat(64),
        expectedEmployeeCount: 0,
        calculatedByUserId: adminId,
        lockedAt: new Date(),
      },
    });
    let stored = new Uint8Array();
    configurePayrollExport(undefined, {
      async put(_key, value) {
        const view = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
        stored = new Uint8Array(view);
      },
      async get() { return null; },
      async delete() { return; },
    });
    const queued = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/exports`).set("Authorization", auth()).send({
      format: "CSV",
      template: { columns: ["employeeName", "grossPay", "advanceDeduction", "calculatedPay", "warnings"] },
    });
    expect(queued.status).toBe(202);
    await processPayrollExport(queued.body.data.id);
    const csv = new TextDecoder().decode(stored);
    expect(csv).toContain("Employee name,Gross pay (MYR),Advance deduction (MYR),Locked calculated pay (MYR),Warnings");
    expect(csv).toContain("Payroll Calculation");
    expect(csv).not.toContain("Regular minutes");
    const job = await prisma.exportJob.findUniqueOrThrow({ where: { id: queued.body.data.id } });
    expect(job).toMatchObject({ status: "COMPLETED", fileName: "October-2026-payroll.csv" });

    const direct = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodId}/download`).set("Authorization", auth()).send({
      format: "CSV",
      template: { columns: ["employeeName", "grossPay", "advanceDeduction", "calculatedPay", "adjustmentEarnings", "adjustmentDeductions", "finalCalculatedPay"] },
    });
    expect(direct.status).toBe(200);
    expect(direct.headers["content-disposition"]).toContain("October-2026-payroll.csv");
    expect(direct.text).toContain("Employee name,Gross pay (MYR),Advance deduction (MYR),Locked calculated pay (MYR),Approved adjustment earnings (MYR),Approved adjustment deductions (MYR),Final calculated pay (MYR)");
    expect(direct.text).toContain(`,10,5,${(lockedCalculatedPaySen + 500) / 100}`);
    expect(await prisma.auditLog.findFirst({ where: { actorUserId: adminId, action: "PAYROLL_EXPORT_DOWNLOADED", entityId: { not: "" } } })).not.toBeNull();
  });
});
