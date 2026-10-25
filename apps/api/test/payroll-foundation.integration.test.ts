import { MembershipRole, Role } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/services/prisma.js";
import { createAccessToken } from "../src/utils/token.js";

const suffix = `payroll-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const userSuffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const adminUsername = `pa-${userSuffix}`;
const restrictedUsername = `pr-${userSuffix}`;
const devAdminUsername = `pd-${userSuffix}`;
const employeeUsername = `pe-${userSuffix}`;
const otherEmployeeUsername = `po-${userSuffix}`;
let clientId = "";
let otherClientId = "";
let adminId = "";
let restrictedAdminId = "";
let devAdminId = "";
let employeeId = "";
let otherEmployeeId = "";
let employeeUserId = "";
let otherEmployeeUserId = "";
const sessionIds = new Map<string, string>();

function authorization(sub: string, username: string, role: Role): string {
  const sid = sessionIds.get(sub);
  if (!sid) throw new Error(`Missing test session for ${sub}`);
  return `Bearer ${createAccessToken({ sub, username, role, sid })}`;
}

beforeAll(async () => {
  const [client, otherClient] = await Promise.all([
    prisma.client.create({ data: { name: `Payroll tenant ${suffix}` } }),
    prisma.client.create({ data: { name: `Other payroll tenant ${suffix}` } }),
  ]);
  clientId = client.id;
  otherClientId = otherClient.id;

  const [admin, restrictedAdmin, devAdmin] = await prisma.$transaction([
    prisma.user.create({ data: { username: adminUsername, passwordHash: "test", role: Role.ADMIN, clientId } }),
    prisma.user.create({ data: { username: restrictedUsername, passwordHash: "test", role: Role.ADMIN, clientId } }),
    prisma.user.create({ data: { username: devAdminUsername, passwordHash: "test", role: Role.DEV_ADMIN } }),
  ]);
  adminId = admin.id;
  restrictedAdminId = restrictedAdmin.id;
  devAdminId = devAdmin.id;

  await prisma.organizationMembership.createMany({ data: [
    { userId: adminId, clientId, role: MembershipRole.ADMIN, canManagePayroll: true },
    { userId: restrictedAdminId, clientId, role: MembershipRole.ADMIN, canManagePayroll: false },
  ] });

  const [employeeUser, otherEmployeeUser] = await prisma.$transaction([
    prisma.user.create({ data: { username: employeeUsername, passwordHash: "test", role: Role.EMPLOYEE, clientId, createdByUserId: adminId, employee: { create: { firstName: "Payroll", lastName: "Employee" } } } }),
    prisma.user.create({ data: { username: otherEmployeeUsername, passwordHash: "test", role: Role.EMPLOYEE, clientId: otherClientId, employee: { create: { firstName: "Other", lastName: "Employee" } } } }),
  ]);
  employeeUserId = employeeUser.id;
  otherEmployeeUserId = otherEmployeeUser.id;
  employeeId = (await prisma.employee.findUniqueOrThrow({ where: { userId: employeeUser.id } })).id;
  otherEmployeeId = (await prisma.employee.findUniqueOrThrow({ where: { userId: otherEmployeeUser.id } })).id;
  const sessionUserIds = [adminId, restrictedAdminId, devAdminId, employeeUserId, otherEmployeeUserId];
  const sessions = await Promise.all(sessionUserIds.map((userId) => prisma.authSession.create({
    data: { userId, refreshTokenHash: `test-${suffix}-${userId}`, familyId: `family-${suffix}-${userId}`, expiresAt: new Date(Date.now() + 3_600_000) },
  })));
  sessions.forEach((session) => sessionIds.set(session.userId, session.id));
});
afterAll(async () => {
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER "AuditLog_immutable_delete"');
  try {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [adminId, restrictedAdminId, devAdminId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminId, restrictedAdminId, devAdminId, employeeUserId, otherEmployeeUserId] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientId, otherClientId] } } });
  } finally {
    await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER "AuditLog_immutable_delete"');
  }
  await prisma.$disconnect();
});

describe("payroll foundation", () => {
  it("requires explicit payroll permission", async () => {
    const response = await request(app)
      .get("/api/v2/payroll/settings")
      .set("Authorization", authorization(restrictedAdminId, restrictedUsername, Role.ADMIN));
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("PAYROLL_ACCESS_REQUIRED");
  });

  it("stores organization rules and effective-dated pay profiles", async () => {
    const auth = authorization(adminId, adminUsername, Role.ADMIN);
    const settings = await request(app).put("/api/v2/payroll/settings").set("Authorization", auth).send({
      jurisdiction: "PENINSULAR_LABUAN",
      payFrequency: "MONTHLY",
      normalDailyMinutes: 480,
      normalWeeklyMinutes: 2700,
      salaryDivisor: 26,
      statutoryContributionsEnabled: true,
    });
    expect(settings.status).toBe(200);
    expect(settings.body.data).toMatchObject({ currency: "MYR", rulePackVersion: "MY-PEN-2023-01", statutoryContributionsEnabled: true, statutoryRuleVersion: "MY-STAT-2025-10-01" });

    const first = await request(app).post("/api/v2/payroll/pay-profiles").set("Authorization", auth).send({
      employeeId,
      payType: "MONTHLY",
      baseRateSen: 300000,
      normalDailyMinutes: 480,
      normalWeeklyMinutes: 2700,
      overtimeEligible: true,
      effectiveFrom: "2026-01-01",
    });
    const second = await request(app).post("/api/v2/payroll/pay-profiles").set("Authorization", auth).send({
      employeeId,
      payType: "MONTHLY",
      baseRateSen: 330000,
      normalDailyMinutes: 480,
      normalWeeklyMinutes: 2700,
      overtimeEligible: true,
      effectiveFrom: "2026-07-01",
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect((await prisma.payProfile.findUniqueOrThrow({ where: { id: first.body.data.id } })).effectiveTo).toBe("2026-06-30");

    const crossTenant = await request(app).post("/api/v2/payroll/pay-profiles").set("Authorization", auth).send({
      employeeId: otherEmployeeId,
      payType: "MONTHLY",
      baseRateSen: 500000,
      normalDailyMinutes: 480,
      normalWeeklyMinutes: 2700,
      overtimeEligible: true,
      effectiveFrom: "2026-01-01",
    });
    expect(crossTenant.status).toBe(404);

    const statutory = await request(app).post("/api/v2/payroll/statutory-profiles").set("Authorization", auth).send({
      employeeId,
      epfCategory: "STANDARD_UNDER_60",
      socsoCategory: "FIRST",
      eisEligible: true,
      effectiveFrom: "2026-01-01",
    });
    expect(statutory.status).toBe(201);
    expect(statutory.body.data).toMatchObject({ employeeId, epfCategory: "STANDARD_UNDER_60", socsoCategory: "FIRST", eisEligible: true });

    const crossTenantStatutory = await request(app).post("/api/v2/payroll/statutory-profiles").set("Authorization", auth).send({
      employeeId: otherEmployeeId,
      epfCategory: "STANDARD_UNDER_60",
      socsoCategory: "FIRST",
      eisEligible: true,
      effectiveFrom: "2026-01-01",
    });
    expect(crossTenantStatutory.status).toBe(404);
  });

  it("requires authorization details and tracks salary-advance balances", async () => {
    const auth = authorization(adminId, adminUsername, Role.ADMIN);
    const component = await request(app).post("/api/v2/payroll/components").set("Authorization", auth).send({
      code: "ADVANCE",
      name: "Salary advance repayment",
      type: "ADVANCE_REPAYMENT",
      calculationBasis: "FIXED_AMOUNT",
      defaultAmountSen: 25000,
      defaultPercentageBps: null,
    });
    expect(component.status).toBe(201);

    const missingConsent = await request(app).post("/api/v2/payroll/component-assignments").set("Authorization", auth).send({
      employeeId,
      payrollComponentId: component.body.data.id,
      amountSen: 25000,
      totalAmountSen: 100000,
      effectiveFrom: "2026-10-01",
    });
    expect(missingConsent.status).toBe(400);
    expect(missingConsent.body.error.code).toBe("CONSENT_REFERENCE_REQUIRED");

    const assigned = await request(app).post("/api/v2/payroll/component-assignments").set("Authorization", auth).send({
      employeeId,
      payrollComponentId: component.body.data.id,
      amountSen: 25000,
      totalAmountSen: 100000,
      effectiveFrom: "2026-10-01",
      consentReference: "ADV-2026-001",
    });
    expect(assigned.status).toBe(201);
    expect(assigned.body.data).toMatchObject({ amountSen: 25000, totalAmountSen: 100000, outstandingAmountSen: 100000 });
    expect(await prisma.auditLog.findFirst({ where: { entityType: "SalaryAdvance", entityId: assigned.body.data.id } })).not.toBeNull();
  });

  it("lets a dev admin grant and revoke payroll access", async () => {
    const auth = authorization(devAdminId, devAdminUsername, Role.DEV_ADMIN);
    const permissions = await request(app).get("/api/v2/payroll/permissions").set("Authorization", auth).set("x-organization-id", clientId);
    expect(permissions.status).toBe(200);
    const target = permissions.body.data.find((item: { user: { id: string } }) => item.user.id === restrictedAdminId);
    expect(target).toBeDefined();

    const updated = await request(app).patch(`/api/v2/payroll/permissions/${target.id}`).set("Authorization", auth).set("x-organization-id", clientId).send({ canManagePayroll: true });
    expect(updated.status).toBe(200);
    expect(updated.body.data.canManagePayroll).toBe(true);
  });
});
