import { Role } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../src/app.js";
import { prisma } from "../src/services/prisma.js";
import { createAccessToken } from "../src/utils/token.js";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
let clientAId = "";
let clientBId = "";
let adminAId = "";
let adminA2Id = "";
let adminBId = "";
let devAdminId = "";
let createdAdminId = "";
let worksiteBId = "";
let createdEmployeeId = "";
let createdAdminEmployeeId = "";

const worksiteInput = { name: `Client B site ${suffix}`, latitude: 2.9, longitude: 101.6, radiusMeters: 150, isActive: true };
const temporaryEmployeePassword = "Integration!Pass9042";

function token(sub: string, username: string, role: Role): string {
  return createAccessToken({ sub, username, role });
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
    prisma.user.create({ data: { username: `dev-${suffix}`, passwordHash: "test", role: Role.DEV_ADMIN } }),
  ]);
  [adminAId, adminA2Id, adminBId, devAdminId] = users.map((user) => user.id);
  const worksite = await prisma.worksite.create({ data: { ...worksiteInput, clientId: clientBId } });
  worksiteBId = worksite.id;
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [adminAId, adminA2Id, adminBId, devAdminId] } } });
  await prisma.worksite.deleteMany({ where: { id: worksiteBId } });
  await prisma.user.deleteMany({ where: { id: { in: [adminAId, adminA2Id, adminBId, devAdminId, createdEmployeeId, createdAdminId, createdAdminEmployeeId] } } });
  await prisma.client.deleteMany({ where: { id: { in: [clientAId, clientBId] } } });
  await prisma.$disconnect();
});

describe("admin worksite client isolation", () => {
  it("does not expose another client's worksites", async () => {
    const response = await request(app).get("/api/v1/admin/worksites").set("Authorization", `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`);
    expect(response.status).toBe(200);
    expect(response.body.worksites).toEqual([]);
  });

  it("does not allow cross-client update or delete", async () => {
    const authorization = `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`;
    const update = await request(app).patch(`/api/v1/admin/worksites/${worksiteBId}`).set("Authorization", authorization).send(worksiteInput);
    const deletion = await request(app).delete(`/api/v1/admin/worksites/${worksiteBId}`).set("Authorization", authorization);
    expect(update.status).toBe(404);
    expect(deletion.status).toBe(404);
    expect(await prisma.worksite.findUnique({ where: { id: worksiteBId } })).not.toBeNull();
  });

  it("allows a dev admin to view all client worksites", async () => {
    const response = await request(app).get("/api/v1/admin/worksites").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`);
    expect(response.status).toBe(200);
    expect(response.body.worksites.some((site: { id: string }) => site.id === worksiteBId)).toBe(true);
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
    expect(sameClientEmployees.body.employees).toEqual([]);

    const schedule = await request(app).put("/api/v1/admin/schedules").set("Authorization", `Bearer ${adminAToken}`).send({ employeeId, workDays: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00", gracePeriodMinutes: 10, isActive: true });
    expect(schedule.status).toBe(200);
    expect(schedule.body.schedule.employeeId).toBe(employeeId);
    const crossClientSchedule = await request(app).put("/api/v1/admin/schedules").set("Authorization", `Bearer ${token(adminBId, `admin-b-${suffix}`, Role.ADMIN)}`).send({ employeeId, workDays: [1], startTime: "10:00", endTime: "18:00", gracePeriodMinutes: 0, isActive: true });
    expect(crossClientSchedule.status).toBe(404);
    const sameClientSchedule = await request(app).put("/api/v1/admin/schedules").set("Authorization", `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`).send({ employeeId, workDays: [1], startTime: "10:00", endTime: "18:00", gracePeriodMinutes: 0, isActive: true });
    expect(sameClientSchedule.status).toBe(404);

    const crossClient = await request(app).patch(`/api/v1/admin/employees/${createdEmployeeId}/status`).set("Authorization", `Bearer ${token(adminBId, `admin-b-${suffix}`, Role.ADMIN)}`).send({ isActive: false });
    expect(crossClient.status).toBe(404);
    const sameClient = await request(app).patch(`/api/v1/admin/employees/${createdEmployeeId}/status`).set("Authorization", `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`).send({ isActive: false });
    expect(sameClient.status).toBe(404);

    const resetPassword = "Reset!Employee9042";
    const forbiddenReset = await request(app).patch(`/api/v1/admin/accounts/${createdEmployeeId}/password`).set("Authorization", `Bearer ${token(adminA2Id, `admin-a2-${suffix}`, Role.ADMIN)}`).send({ password: resetPassword });
    expect(forbiddenReset.status).toBe(404);
    const reset = await request(app).patch(`/api/v1/admin/accounts/${createdEmployeeId}/password`).set("Authorization", `Bearer ${adminAToken}`).send({ password: resetPassword });
    expect(reset.status).toBe(200);
    expect((await request(app).post("/api/v1/auth/login").send({ username, password: temporaryEmployeePassword })).status).toBe(401);
    const resetLogin = await request(app).post("/api/v1/auth/login").send({ username, password: resetPassword });
    expect(resetLogin.status).toBe(200);
    expect(resetLogin.body.user.mustChangePassword).toBe(true);

    const deactivated = await request(app).patch(`/api/v1/admin/employees/${createdEmployeeId}/status`).set("Authorization", `Bearer ${adminAToken}`).send({ isActive: false });
    expect(deactivated.status).toBe(200);
    const login = await request(app).post("/api/v1/auth/login").send({ username, password: resetPassword });
    expect(login.status).toBe(401);
    expect(await prisma.employee.findUnique({ where: { userId: createdEmployeeId } })).not.toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { actorUserId: adminAId, action: "DEACTIVATE", entityType: "Employee", entityId: createdEmployeeId } })).not.toBeNull();
  });

  it("allows only dev admins to create and reset administrator accounts", async () => {
    const input = { username: `created-admin-${suffix}`, displayName: "Created Admin", password: "Create!Admin9042" };
    const forbidden = await request(app).post("/api/v1/admin/admins").set("Authorization", `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`).send(input);
    expect(forbidden.status).toBe(403);

    const created = await request(app).post("/api/v1/admin/admins").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`).send(input);
    expect(created.status).toBe(201);
    createdAdminId = created.body.admin.id;
    expect(created.body.admin).toMatchObject({ username: input.username, role: Role.ADMIN });
    expect(created.body.admin.clientId).toEqual(expect.any(String));

    const employee = await request(app)
      .post("/api/v1/admin/employees")
      .set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`)
      .send({ username: `owned-employee-${suffix}`, password: temporaryEmployeePassword, firstName: "Owned", lastName: "Employee", ownerAdminId: createdAdminId });
    expect(employee.status).toBe(201);
    createdAdminEmployeeId = employee.body.employee.id;
    expect(employee.body.employee.ownerAdmin).toMatchObject({ id: createdAdminId, username: input.username });
    const ownedEmployee = await prisma.user.findUnique({ where: { id: createdAdminEmployeeId }, select: { clientId: true, createdByUserId: true } });
    expect(ownedEmployee).toMatchObject({ clientId: created.body.admin.clientId, createdByUserId: createdAdminId });

    const replacement = "Reset!Admin9042";
    const reset = await request(app).patch(`/api/v1/admin/accounts/${createdAdminId}/password`).set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`).send({ password: replacement });
    expect(reset.status).toBe(200);
    expect((await request(app).post("/api/v1/auth/login").send({ username: input.username, password: input.password })).status).toBe(401);
    const login = await request(app).post("/api/v1/auth/login").send({ username: input.username, password: replacement });
    expect(login.status).toBe(200);
    expect(login.body.user.mustChangePassword).toBe(true);

    const deactivated = await request(app).patch(`/api/v1/admin/admins/${createdAdminId}/status`).set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`).send({ isActive: false });
    expect(deactivated.status).toBe(200);
    expect(deactivated.body.admin.isActive).toBe(false);
    expect((await request(app).post("/api/v1/auth/login").send({ username: input.username, password: replacement })).status).toBe(401);
  });

  it("scopes audit history by client", async () => {
    const clientA = await request(app).get("/api/v1/admin/audit").set("Authorization", `Bearer ${token(adminAId, `admin-a-${suffix}`, Role.ADMIN)}`);
    const clientB = await request(app).get("/api/v1/admin/audit").set("Authorization", `Bearer ${token(adminBId, `admin-b-${suffix}`, Role.ADMIN)}`);
    const dev = await request(app).get("/api/v1/admin/audit").set("Authorization", `Bearer ${token(devAdminId, `dev-${suffix}`, Role.DEV_ADMIN)}`);
    expect(clientA.status).toBe(200);
    expect(clientA.body.audit.some((entry: { entityId: string }) => entry.entityId === createdEmployeeId)).toBe(true);
    expect(clientB.status).toBe(200);
    expect(clientB.body.audit).toEqual([]);
    expect(dev.status).toBe(200);
    expect(dev.body.audit.length).toBeGreaterThanOrEqual(clientA.body.audit.length);
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
    expect(response.body.webhook).toMatchObject({ events: ["attendance.clock_in", "attendance.clock_out"], method: "POST", signatureAlgorithm: "HMAC-SHA256" });
    expect(response.body.webhook).not.toHaveProperty("secret");
  });
});
