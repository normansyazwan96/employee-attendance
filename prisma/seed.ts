import { PrismaClient, Role } from "@prisma/client";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const prisma = new PrismaClient();
const scrypt = promisify(scryptCallback);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString("hex")}`;
}

function seedPassword(name: string): string {
  const value = process.env[name];
  if (!value || value.length < 12 || !/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value) || !/[^A-Za-z0-9]/.test(value)) {
    throw new Error(`${name} must be at least 12 characters and include uppercase, lowercase, number, and symbol characters`);
  }
  return value;
}

async function main(): Promise<void> {
  const client = await prisma.client.upsert({ where: { id: "acme-local" }, update: { name: "Acme Local" }, create: { id: "acme-local", name: "Acme Local" } });
  await prisma.worksite.upsert({ where: { clientId_name: { clientId: client.id, name: "Acme Local HQ" } }, update: { latitude: 2.9084686453776176, longitude: 101.60997566744295, radiusMeters: 150, isActive: true }, create: { clientId: client.id, name: "Acme Local HQ", latitude: 2.9084686453776176, longitude: 101.60997566744295, radiusMeters: 150 } });
  const accounts = [
    { email: "devadmin@attendance.local", role: Role.DEV_ADMIN, clientId: null, password: seedPassword("SEED_DEV_ADMIN_PASSWORD") },
    { email: "admin@acme.local", role: Role.ADMIN, clientId: client.id, password: seedPassword("SEED_ADMIN_PASSWORD") },
    { email: "john.smith@acme.local", role: Role.EMPLOYEE, clientId: client.id, password: seedPassword("SEED_EMPLOYEE_PASSWORD") },
  ];
  for (const { password, ...account } of accounts) {
    const passwordHash = await hashPassword(password);
    await prisma.user.upsert({
      where: { email: account.email },
      update: { role: account.role, clientId: account.clientId, passwordHash, passwordVersion: { increment: 1 }, mustChangePassword: true },
      create: { ...account, passwordHash, mustChangePassword: true },
    });
  }
  const seededAdmin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@acme.local" } });
  const john = await prisma.user.findUniqueOrThrow({ where: { email: "john.smith@acme.local" } });
  await prisma.user.update({ where: { id: john.id }, data: { createdByUserId: seededAdmin.id } });
  const johnEmployee = await prisma.employee.upsert({ where: { userId: john.id }, update: { firstName: "John", lastName: "Smith" }, create: { userId: john.id, firstName: "John", lastName: "Smith" } });

  const attendanceSamples = [
    { workDate: "2026-09-10", clockInAt: new Date("2026-09-10T08:00:00Z"), clockOutAt: new Date("2026-09-10T17:00:00Z"), status: "CLOCKED_OUT" as const },
    { workDate: "2026-09-11", clockInAt: new Date("2026-09-11T08:00:00Z"), clockOutAt: new Date("2026-09-11T20:00:00Z"), status: "CLOCKED_OUT" as const },
    { workDate: "2026-09-12", clockInAt: new Date("2026-09-12T08:30:00Z"), clockOutAt: new Date("2026-09-12T13:30:00Z"), status: "CLOCKED_OUT" as const },
  ];

  for (const sample of attendanceSamples) {
    await prisma.attendanceRecord.upsert({
      where: { employeeId_workDate: { employeeId: johnEmployee.id, workDate: sample.workDate } },
      update: {
        clockInAt: sample.clockInAt,
        clockOutAt: sample.clockOutAt,
        status: sample.status,
      },
      create: {
        employeeId: johnEmployee.id,
        workDate: sample.workDate,
        clockInAt: sample.clockInAt,
        clockOutAt: sample.clockOutAt,
        status: sample.status,
      },
    });
  }

  console.info("Seeded users with passwords supplied through environment variables. Each user must change their password after signing in.");
}

main().catch((error: unknown) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());
