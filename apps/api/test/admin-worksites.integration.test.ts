import { MembershipRole, Role } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/services/prisma.js";
import { createAccessToken, verifyAccessToken } from "../src/utils/token.js";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let clientAId = "";
let clientBId = "";
let adminAId = "";
let adminA2Id = "";
let adminBId = "";
let inconsistentAdminId = "";
let devAdminId = "";
let createdAdminId = "";
let createdManagerId = "";
let worksiteBId = "";
let createdEmployeeId = "";
let createdAdminEmployeeId = "";
let departmentBId = "";
let payPeriodBId = "";
let employeeAUserId = "";
let employeeA2UserId = "";
let employeeBUserId = "";
let concurrentEmployeeUserId = "";
let attendanceEventBId = "";
const sessionIds = new Map<string, string>();

const worksiteInput = { name: `Client B site ${suffix}`, stateCode: "10", latitude: 2.9, longitude: 101.6, radiusMeters: 150, isActive: true };
const temporaryEmployeePassword = "Aa1!5678";

function token(sub: string, username: string, role: Role): string {
  const sid = sessionIds.get(sub);
  if (!sid) throw new Error(`Missing test session for ${sub}`);
  return createAccessToken({ sub, username, role, sid });
}

beforeAll(async () => {
  const [clientA, clientB] = await Promise.all([
    prisma.client.create({ data: { name: `Isolation A ${suffix}` } }),
    prisma.client.create({ data: { name: `Isolation B ${suffix}` } }),
  ]);
  clientAId = clientA.id;
  clientBId = clientB.id;
  const users = await prisma.$transaction([
    prisma.user.create({ data: { username: `admin-a-${suffix}`, passwordHash: "test", role: Role.ADMIN, clientId: clientAId } }),
    prisma.user.create({ data: { username: `admin-a2-${suffix}`, passwordHash: "test", role: Role.ADMIN, clientId: clientAId } }),
    prisma.user.create({ data: { username: `admin-b-${suffix}`, passwordHash: "test", role: Role.ADMIN, clientId: clientBId } }),
    prisma.user.create({ data: { username: `admin-inconsistent-${suffix}`, passwordHash: "test", role: Role.ADMIN, clientId: clientAId } }),
    prisma.user.create({ data: { username: `dev-${suffix}`, passwordHash: "test", role: Role.DEV_ADMIN } }),
  ]);
  [adminAId, adminA2Id, adminBId, inconsistentAdminId, devAdminId] = users.map((user) => user.id);
  await prisma.organizationMembership.createMany({ data: [
    { userId: adminAId, clientId: clientAId, role: MembershipRole.ADMIN, canManagePayroll: true },
    { userId: adminA2Id, clientId: clientAId, role: MembershipRole.ADMIN, canManagePayroll: true },
    { userId: adminBId, clientId: clientBId, role: MembershipRole.ADMIN, canManagePayroll: true },
    { userId: inconsistentAdminId, clientId: clientBId, role: MembershipRole.ADMIN },
  ] });
  const worksite = await prisma.worksite.create({ data: { ...worksiteInput, clientId: clientBId, ownerAdminId: null } });
  worksiteBId = worksite.id;
  const [departmentB, payPeriodB, employeeAUser, employeeA2User, employeeBUser, concurrentEmployeeUser] = await prisma.$transaction([
    prisma.department.create({ data: { clientId: clientBId, name: `Private department ${suffix}` } }),
    prisma.payPeriod.create({ data: { clientId: clientBId, name: `Private payroll ${suffix}`, startDate: "2026-10-01", endDate: "2026-10-31" } }),
    prisma.user.create({ data: { username: `employee-a-${suffix}`, passwordHash: "test", role: Role.EMPLOYEE, clientId: clientAId, createdByUserId: adminAId, memberships: { create: { clientId: clientAId, role: MembershipRole.EMPLOYEE } }, employee: { create: { firstName: "Admin A", lastName: "Employee" } } } }),
    prisma.user.create({ data: { username: `employee-a2-${suffix}`, passwordHash: "test", role: Role.EMPLOYEE, clientId: clientAId, createdByUserId: adminA2Id, memberships: { create: { clientId: clientAId, role: MembershipRole.EMPLOYEE } }, employee: { create: { firstName: "Admin A2", lastName: "Employee" } } } }),
    prisma.user.create({ data: { username: `employee-b-${suffix}`, passwordHash: "test", role: Role.EMPLOYEE, clientId: clientBId, createdByUserId: adminBId, memberships: { create: { clientId: clientBId, role: MembershipRole.EMPLOYEE } }, employee: { create: { firstName: "Private", lastName: "Employee" } } } }),
    prisma.user.create({ data: { username: `concurrent-${suffix}`, passwordHash: "test", role: Role.EMPLOYEE, clientId: clientBId, createdByUserId: adminBId, memberships: { create: { clientId: clientBId, role: MembershipRole.EMPLOYEE } }, employee: { create: { firstName: "Concurrent", lastName: "Employee" } } } }),
  ]);
  departmentBId = departmentB.id;
  payPeriodBId = payPeriodB.id;
  employeeAUserId = employeeAUser.id;
  employeeA2UserId = employeeA2User.id;
  employeeBUserId = employeeBUser.id;
  concurrentEmployeeUserId = concurrentEmployeeUser.id;
  const sessionUserIds = [adminAId, adminA2Id, adminBId, inconsistentAdminId, devAdminId, employeeAUserId, employeeA2UserId, employeeBUserId, concurrentEmployeeUserId];
  const sessions = await Promise.all(sessionUserIds.map((userId) => prisma.authSession.create({
    data: { userId, refreshTokenHash: `test-${suffix}-${userId}`, familyId: `family-${suffix}-${userId}`, expiresAt: new Date(Date.now() + 3_600_000) },
  })));
  sessions.forEach((session) => sessionIds.set(session.userId, session.id));
  const employeeB = await prisma.employee.findUniqueOrThrow({ where: { userId: employeeBUser.id } });
  const attendanceEventB = await prisma.attendanceEvent.create({ data: { employeeId: employeeB.id, clientId: clientBId, workDate: "2026-10-23", type: "CLOCK_IN", occurredAt: new Date("2026-10-23T01:00:00.000Z"), worksiteId: worksiteBId, latitude: 2.9, longitude: 101.6, accuracyMeters: 12, distanceMeters: 4, acceptedRadiusMeters: 150, idempotencyKey: `isolation-${suffix}` } });
  attendanceEventBId = attendanceEventB.id;
});

afterAll(async () => {
  await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER "AuditLog_immutable_delete"');
  await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" DISABLE TRIGGER "AttendanceEvent_immutable_delete"');
  await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" DISABLE TRIGGER "AttendanceEvent_immutable_update"');
  try {
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [adminAId, adminA2Id, adminBId, devAdminId, concurrentEmployeeUserId] } } });
    await prisma.worksite.deleteMany({ where: { clientId: { in: [clientAId, clientBId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [adminAId, adminA2Id, adminBId, inconsistentAdminId, devAdminId, createdEmployeeId, createdAdminId, createdManagerId, createdAdminEmployeeId, employeeAUserId, employeeA2UserId, employeeBUserId, concurrentEmployeeUserId] } } });
    await prisma.client.deleteMany({ where: { id: { in: [clientAId, clientBId] } } });
  } finally {
    try {
      await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" ENABLE TRIGGER "AttendanceEvent_immutable_delete"');
    } finally {
      try {
        await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" ENABLE TRIGGER "AttendanceEvent_immutable_update"');
      } finally {
        await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER "AuditLog_immutable_delete"');
      }
    }
  }
  await prisma.$disconnect();
});

describe("admin worksite client isolation", () => {
  it("isolates new workforce, payroll, and exact-location resources", async () => {
    const adminAAuth = `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`;
    const departments = await request(app).get("/api/v2/workforce/departments").set("Authorization", adminAAuth);
    expect(departments.status).toBe(200);
    expect(departments.body.data.some((item: { id: string }) => item.id === departmentBId)).toBe(false);

    const periods = await request(app).get("/api/v2/payroll/pay-periods").set("Authorization", adminAAuth);
    expect(periods.status).toBe(200);
    expect(periods.body.data.some((item: { id: string }) => item.id === payPeriodBId)).toBe(false);
    const transition = await request(app).post(`/api/v2/payroll/pay-periods/${payPeriodBId}/transition`).set("Authorization", adminAAuth).send({ action: "REVIEW" });
    expect(transition.status).toBe(404);

    const exactLocation = await request(app).get(`/api/v2/workforce/attendance-events/${attendanceEventBId}/location`).set("Authorization", adminAAuth);
    expect(exactLocation.status).toBe(404);
    expect(exactLocation.body).not.toHaveProperty("latitude");
  });

  it("keeps attendance facts immutable while allowing GPS retention redaction", async () => {
    await expect(prisma.attendanceEvent.update({ where: { id: attendanceEventBId }, data: { workDate: "2026-10-24" } })).rejects.toThrow(/immutable/i);
    const redacted = await prisma.attendanceEvent.update({ where: { id: attendanceEventBId }, data: { latitude: null, longitude: null, accuracyMeters: null } });
    expect(redacted).toMatchObject({ latitude: null, longitude: null, accuracyMeters: null, workDate: "2026-10-23" });
    await expect(prisma.attendanceEvent.delete({ where: { id: attendanceEventBId } })).rejects.toThrow(/immutable/i);
  });

  it("serializes concurrent clock actions and replays an idempotent duplicate", async () => {
    const authorization = `Bearer ${token(concurrentEmployeeUserId, `concurrent-${suffix}`, Role.EMPLOYEE)}`;
    const idempotencyKey = `concurrent-clock-${suffix}`;
    const submit = () => request(app)
      .post("/api/v2/attendance/events/clock-in")
      .set("Authorization", authorization)
      .set("Idempotency-Key", idempotencyKey)
      .send({ location: { latitude: 2.9, longitude: 101.6, accuracy: 10 } });

    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 201]);
    expect(responses.filter((response) => response.body.replayed === true)).toHaveLength(1);
    expect(await prisma.attendanceEvent.count({ where: { idempotencyKey } })).toBe(1);
  });

  it("prevents inactive employment statuses from recording attendance", async () => {
    const employee = await prisma.employee.findUniqueOrThrow({ where: { userId: employeeBUserId } });
    await prisma.employee.update({ where: { id: employee.id }, data: { employmentStatus: "TERMINATED", terminationDate: new Date("2026-10-22T00:00:00.000Z") } });
    const response = await request(app)
      .post("/api/v2/attendance/events/clock-out")
      .set("Authorization", `Bearer ${token(employeeBUserId, `employee-b-${suffix}`, Role.EMPLOYEE)}`)
      .set("Idempotency-Key", `inactive-${suffix}`)
      .send({ location: { latitude: 2.9, longitude: 101.6, accuracy: 10 } });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("EMPLOYMENT_INACTIVE");
  });

  it("does not expose another client's worksites", async () => {
    const response = await request(app).get("/api/v1/admin/worksites").set("Authorization", `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`).set("x-organization-id", clientBId);
    expect(response.status).toBe(200);
    expect(response.body.worksites).toEqual([]);
  });

  it("shares organization worksites between administrators without crossing organizations", async () => {
    const adminAAuth = `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`;
    const adminA2Auth = `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`;
    const privateInput = { name: `Admin A private site ${suffix}`, stateCode: "10", latitude: 4.123, longitude: 100.123, radiusMeters: 150, isActive: true };
    const sharedInput = { name: `Organization site ${suffix}`, stateCode: "14", latitude: 5.123, longitude: 100.123, radiusMeters: 150, isActive: true };

    const privateCreation = await request(app).post("/api/v1/admin/worksites").set("Authorization", adminAAuth).send(privateInput);
    expect(privateCreation.status).toBe(201);
    expect(privateCreation.body.worksite).toMatchObject({ ownerAdminId: adminAId, canManage: true });
    const privateId = privateCreation.body.worksite.id as string;

    const sharedCreation = await request(app)
      .post("/api/v1/admin/worksites")
      .set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`)
      .set("x-organization-id", clientAId)
      .send(sharedInput);
    expect(sharedCreation.status).toBe(201);
    expect(sharedCreation.body.worksite).toMatchObject({ ownerAdminId: null, canManage: true });
    const sharedId = sharedCreation.body.worksite.id as string;

    await prisma.auditLog.create({
      data: {
        actorUserId: adminA2Id,
        clientId: clientAId,
        action: "UPDATE",
        entityType: "Worksite",
        entityId: privateId,
        details: { ...privateInput, radiusMeters: 175 },
      },
    });
    await prisma.auditLog.create({
      data: {
        actorUserId: adminA2Id,
        clientId: clientAId,
        action: "CLOCK_IN",
        entityType: "AttendanceEvent",
        entityId: `legacy-event-${suffix}`,
        details: { workDate: "2026-10-23", worksiteId: privateId },
      },
    });

    const adminAList = await request(app).get("/api/v1/admin/worksites").set("Authorization", adminAAuth);
    expect(adminAList.body.worksites).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: privateId, canManage: true }),
      expect.objectContaining({ id: sharedId, canManage: true }),
    ]));

    const adminA2List = await request(app).get("/api/v1/admin/worksites").set("Authorization", adminA2Auth);
    expect(adminA2List.body.worksites).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: privateId, canManage: true }),
      expect.objectContaining({ id: sharedId, canManage: true }),
    ]));

    const adminA2Audit = await request(app).get("/api/v1/admin/audit").set("Authorization", adminA2Auth);
    expect(adminA2Audit.status).toBe(403);
    expect(adminA2Audit.body.audit).toBeUndefined();

    const privateUpdate = await request(app).patch(`/api/v1/admin/worksites/${privateId}`).set("Authorization", adminAAuth).send({ ...privateInput, radiusMeters: 175 });
    expect(privateUpdate.status).toBe(200);
    const sameOrganizationPrivateUpdate = await request(app).patch(`/api/v1/admin/worksites/${privateId}`).set("Authorization", adminA2Auth).send({ ...privateInput, radiusMeters: 200 });
    const sameOrganizationSharedUpdate = await request(app).patch(`/api/v1/admin/worksites/${sharedId}`).set("Authorization", adminAAuth).send(sharedInput);
    expect(sameOrganizationPrivateUpdate.status).toBe(200);
    expect(sameOrganizationSharedUpdate.status).toBe(200);

    const ownerLocation = await request(app)
      .post("/api/v1/attendance/location-status")
      .set("Authorization", `Bearer ${token(employeeAUserId, `employee-a-${suffix}`, Role.EMPLOYEE)}`)
      .send({ location: { latitude: privateInput.latitude, longitude: privateInput.longitude, accuracy: 10 } });
    expect(ownerLocation.body.location).toMatchObject({ valid: true, worksite: { id: privateId } });

    const otherAdminLocation = await request(app)
      .post("/api/v1/attendance/location-status")
      .set("Authorization", `Bearer ${token(employeeA2UserId, `employee-a2-${suffix}`, Role.EMPLOYEE)}`)
      .send({ location: { latitude: privateInput.latitude, longitude: privateInput.longitude, accuracy: 10 } });
    expect(otherAdminLocation.body.location).toMatchObject({ valid: true, worksite: { id: privateId } });
  });

  it("rejects inconsistent legacy client and membership assignments", async () => {
    const response = await request(app).get("/api/v1/admin/worksites").set("Authorization", `Bearer ${token(inconsistentAdminId, `admin-inconsistent-${suffix}`, Role.ADMIN)}`);
    expect(response.status).toBe(401);
  });

  it("does not allow cross-client update or delete", async () => {
    const authorization = `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`;
    const update = await request(app).patch(`/api/v1/admin/worksites/${worksiteBId}`).set("Authorization", authorization).send(worksiteInput);
    const deletion = await request(app).delete(`/api/v1/admin/worksites/${worksiteBId}`).set("Authorization", authorization);
    expect(update.status).toBe(404);
    expect(deletion.status).toBe(404);
    expect(await prisma.worksite.findUnique({ where: { id: worksiteBId } })).not.toBeNull();
  });

  it("shares manager administration within an organization only", async () => {
    const adminAAuth = `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`;
    const adminA2Auth = `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`;
    const adminBAuth = `Bearer ${token(adminBId, `admin-b-${suffix}`, Role.ADMIN)}`;
    const created = await request(app).post("/api/v2/workforce/managers").set("Authorization", adminAAuth).send({ username: `manager-${suffix}`, displayName: "Shared Manager", password: "Manager!123" });
    expect(created.status).toBe(201);
    createdManagerId = created.body.data.id;

    const sameOrganization = await request(app).get("/api/v2/workforce/managers").set("Authorization", adminA2Auth);
    expect(sameOrganization.status).toBe(200);
    expect(sameOrganization.body.data.some((manager: { userId: string }) => manager.userId === createdManagerId)).toBe(true);

    const otherOrganization = await request(app).get("/api/v2/workforce/managers").set("Authorization", adminBAuth);
    expect(otherOrganization.status).toBe(200);
    expect(otherOrganization.body.data.some((manager: { userId: string }) => manager.userId === createdManagerId)).toBe(false);

    const sameOrganizationUpdate = await request(app).patch(`/api/v2/workforce/managers/${createdManagerId}/status`).set("Authorization", adminA2Auth).send({ isActive: false });
    expect(sameOrganizationUpdate.status).toBe(204);
    const otherOrganizationUpdate = await request(app).patch(`/api/v2/workforce/managers/${createdManagerId}/status`).set("Authorization", adminBAuth).send({ isActive: true });
    expect(otherOrganizationUpdate.status).toBe(404);
  });

  it("requires a dev admin to select an organization before viewing worksites", async () => {
    const response = await request(app).get("/api/v1/admin/worksites").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`);
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Select an organization");
  });

  it("allows a dev admin to narrow legacy resources to one selected organization", async () => {
    const response = await request(app).get("/api/v1/admin/worksites").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`).set("x-organization-id", clientAId);
    expect(response.status).toBe(200);
    expect(response.body.worksites.some((site: { id: string }) => site.id === worksiteBId)).toBe(false);
  });

  it("creates and deactivates an employee without deleting the account", async () => {
    const adminAToken = token(adminAId, `admin-a-${suffix}`, Role.ADMIN);
    const username = `employee-${suffix}`;
    const invalid = await request(app).post("/api/v1/admin/employees").set("Authorization", `Bearer ${adminAToken}`).send({ username: "@", password: temporaryEmployeePassword, firstName: "Test", lastName: "Employee" });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toContain("Username");

    const created = await request(app).post("/api/v1/admin/employees").set("Authorization", `Bearer ${adminAToken}`).send({ username, password: temporaryEmployeePassword, firstName: "Test", lastName: "Employee" });
    expect(created.status).toBe(201);
    createdEmployeeId = created.body.employee.id;
    const employeeId = created.body.employee.employeeId as string;

    const sameClientEmployees = await request(app).get("/api/v1/admin/employees").set("Authorization", `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`);
    expect(sameClientEmployees.status).toBe(200);
    expect(sameClientEmployees.body.employees.some((employee: { id: string }) => employee.id === createdEmployeeId)).toBe(true);

    const schedule = await request(app).put("/api/v1/admin/schedules").set("Authorization", `Bearer ${adminAToken}`).send({ employeeId, workDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", gracePeriodMinutes: 10, isActive: true });
    expect(schedule.status).toBe(200);
    expect(schedule.body.schedule.employeeId).toBe(employeeId);
    const crossClientSchedule = await request(app).put("/api/v1/admin/schedules").set("Authorization", `Bearer ${token(adminBId, `admin-b-${suffix}`, Role.ADMIN)}`).send({ employeeId, workDays: [1], startTime: "10:00", endTime: "18:00", gracePeriodMinutes: 0, isActive: true });
    expect(crossClientSchedule.status).toBe(404);
    const sameClientSchedule = await request(app).put("/api/v1/admin/schedules").set("Authorization", `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`).send({ employeeId, workDays: [1], startTime: "10:00", endTime: "18:00", gracePeriodMinutes: 0, isActive: true });
    expect(sameClientSchedule.status).toBe(200);

    const crossClient = await request(app).patch(`/api/v1/admin/employees/${createdEmployeeId}/status`).set("Authorization", `Bearer ${token(adminBId, `admin-b-${suffix}`, Role.ADMIN)}`).send({ isActive: false });
    expect(crossClient.status).toBe(404);
    const sameClient = await request(app).patch(`/api/v1/admin/employees/${createdEmployeeId}/status`).set("Authorization", `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`).send({ isActive: false });
    expect(sameClient.status).toBe(200);
    const sameClientReactivation = await request(app).patch(`/api/v1/admin/employees/${createdEmployeeId}/status`).set("Authorization", `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`).send({ isActive: true });
    expect(sameClientReactivation.status).toBe(200);

    const resetPassword = "Reset!Employee9042";
    const reset = await request(app).patch(`/api/v1/admin/accounts/${createdEmployeeId}/password`).set("Authorization", `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`).send({ password: resetPassword });
    expect(reset.status).toBe(200);
    expect((await request(app).post("/api/v1/auth/login").send({ username, password: temporaryEmployeePassword })).status).toBe(401);
    const resetLogin = await request(app).post("/api/v1/auth/login").send({ username, password: resetPassword });
    expect(resetLogin.status).toBe(200);
    expect(resetLogin.body.user.mustChangePassword).toBe(true);
    const legacyLoginToken = verifyAccessToken(resetLogin.body.token);
    expect(legacyLoginToken?.sid).toEqual(expect.any(String));
    expect(await prisma.authSession.findUnique({ where: { id: legacyLoginToken!.sid! } })).not.toBeNull();

    const deactivated = await request(app).patch(`/api/v1/admin/employees/${createdEmployeeId}/status`).set("Authorization", `Bearer ${adminAToken}`).send({ isActive: false });
    expect(deactivated.status).toBe(200);
    const login = await request(app).post("/api/v1/auth/login").send({ username, password: resetPassword });
    expect(login.status).toBe(401);
    expect(await prisma.employee.findUnique({ where: { userId: createdEmployeeId } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { actorUserId: adminAId, action: "DEACTIVATE", entityType: "Employee", entityId: createdEmployeeId } })).not.toBeNull();
  });

  it("allows only dev admins to create and reset administrator accounts", async () => {
    const input = { username: `created-admin-${suffix}`, displayName: "Created Admin", password: "Bb2@5678" };
    const forbidden = await request(app).post("/api/v1/admin/admins").set("Authorization", `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`).send(input);
    expect(forbidden.status).toBe(403);

    const missingOrganization = await request(app).post("/api/v1/admin/admins").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`).send(input);
    expect(missingOrganization.status).toBe(400);
    expect(missingOrganization.body.error).toContain("Select an organization");

    const created = await request(app).post("/api/v1/admin/admins").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`).set("x-organization-id", clientAId).send(input);
    expect(created.status).toBe(201);
    createdAdminId = created.body.admin.id;
    expect(created.body.admin).toMatchObject({ username: input.username, role: Role.ADMIN });
    expect(created.body.admin.clientId).toBe(clientAId);

    const missingEmployeeOrganization = await request(app)
      .post("/api/v1/admin/employees")
      .set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`)
      .send({ username: `unassigned-${suffix}`, password: temporaryEmployeePassword, firstName: "Unassigned", lastName: "Employee" });
    expect(missingEmployeeOrganization.status).toBe(400);
    expect(missingEmployeeOrganization.body.error).toContain("Select an organization");

    const employee = await request(app)
      .post("/api/v1/admin/employees")
      .set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`)
      .set("x-organization-id", clientAId)
      .send({ username: `owned-${suffix}`, password: temporaryEmployeePassword, firstName: "Owned", lastName: "Employee" });
    expect(employee.status).toBe(201);
    createdAdminEmployeeId = employee.body.employee.id;
    expect(employee.body.employee.ownerAdmin).toBeNull();
    const ownedEmployee = await prisma.user.findUnique({ where: { id: createdAdminEmployeeId }, select: { clientId: true, createdByUserId: true } });
    expect(ownedEmployee).toMatchObject({ clientId: created.body.admin.clientId, createdByUserId: devAdminId });

    const replacement = "Cc3#5678";
    const reset = await request(app).patch(`/api/v1/admin/accounts/${createdAdminId}/password`).set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`).set("x-organization-id", clientAId).send({ password: replacement });
    expect(reset.status).toBe(200);
    expect((await request(app).post("/api/v1/auth/login").send({ username: input.username, password: input.password })).status).toBe(401);
    const login = await request(app).post("/api/v1/auth/login").send({ username: input.username, password: replacement });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    const deactivated = await request(app).patch(`/api/v1/admin/admins/${createdAdminId}/status`).set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`).set("x-organization-id", clientAId).send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.admin.isActive).toBe(false);
    expect((await request(app).post("/api/v1/auth/login").send({ username: input.username, password: replacement })).status).toBe(401);
  });

  it("allows audit history only for dev admins", async () => {
    const clientA = await request(app).get("/api/v1/admin/audit").set("Authorization", `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`);
    const clientB = await request(app).get("/api/v1/admin/audit").set("Authorization", `Bearer ${token(adminBId, `admin-b-${suffix}`, Role.ADMIN)}`);
    const dev = await request(app).get("/api/v1/admin/audit").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`);
    expect(clientA.status).toBe(403);
    expect(clientA.body.audit).toBeUndefined();
    expect(clientB.status).toBe(403);
    expect(clientB.body.audit).toBeUndefined();
    expect(dev.status).toBe(200);
    expect(dev.body.audit.some((entry: { entityId: string }) => entry.entityId === createdEmployeeId)).toBe(true);
  });

  it("supports paginated attendance date filters", async () => {
    const response = await request(app).get("/api/v1/admin/attendance?page=1&pageSize=1&from=2020-01-01&to=2030-12-31").set("Authorization", `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`);
    expect(response.status).toBe(200);
    expect(response.body.pagination).toMatchObject({ page: 1, pageSize: 1 });
    expect(response.body.attendance.length).toBeLessThanOrEqual(1);
  });

  it("exports scoped attendance as CSV without GPS fields", async () => {
    const response = await request(app).get("/api/v1/admin/attendance/export?from=2020-01-01&to=2030-12-31").set("Authorization", `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("text/csv");
    expect(response.text).toContain("Employee,Username,Work date");
    expect(response.text).not.toContain("Latitude");
  });

  it("allows every authenticated role to read and update its profile", async () => {
    const response = await request(app).get("/api/v1/profile").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`);
    expect(response.status).toBe(200);
    const updatedUsername = `dev-renamed-${suffix}`;
    const updated = await request(app).patch("/api/v1/profile").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`).send({ username: updatedUsername, displayName: "Platform Owner" });
    expect(updated.status).toBe(200);
    expect(updated.body.profile.username).toBe(updatedUsername);
    expect(updated.body.profile.displayName).toBe("Platform Owner");
    expect(updated.body.token).toEqual(expect.any(String));
    const refreshed = await request(app).get("/api/v1/profile").set("Authorization", `Bearer ${updated.body.token}`);
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.profile.username).toBe(updatedUsername);
  });

  it("exposes webhook configuration details only to dev admins", async () => {
    const forbidden = await request(app).get("/api/v1/admin/system/webhook").set("Authorization", `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`);
    expect(forbidden.status).toBe(403);
    const response = await request(app).get("/api/v1/admin/system/webhook").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`);
    expect(response.status).toBe(200);
    expect(response.body.webhook).toMatchObject({ events: ["attendance.clock_in", "attendance.clock_out", "attendance.break_start", "attendance.break_end"], method: "POST", signatureAlgorithm: "HMAC-SHA256" });
    expect(response.body.webhook).not.toHaveProperty("secret");
  });
});
