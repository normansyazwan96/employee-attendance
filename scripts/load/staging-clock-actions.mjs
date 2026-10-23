import { createHmac, randomBytes } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const baseUrl = process.env.LOAD_TEST_BASE_URL?.replace(/\/$/, "");
const connectionString = process.env.DATABASE_URL;
const jwtSecret = process.env.LOAD_TEST_JWT_SECRET;
const confirmation = process.env.LOAD_TEST_CONFIRM;
const userCount = Number(process.env.LOAD_TEST_USERS ?? "100");
const latitude = Number(process.env.LOAD_TEST_LATITUDE ?? "3.139");
const longitude = Number(process.env.LOAD_TEST_LONGITUDE ?? "101.6869");

if (!baseUrl || !connectionString || !jwtSecret) throw new Error("Set LOAD_TEST_BASE_URL, DATABASE_URL, and LOAD_TEST_JWT_SECRET");
if (jwtSecret.length < 32) throw new Error("LOAD_TEST_JWT_SECRET must be at least 32 characters");
if (confirmation !== "STAGING_ONLY") throw new Error("Set LOAD_TEST_CONFIRM=STAGING_ONLY to allow temporary staging data");
if (!new URL(baseUrl).hostname.includes("-staging.")) throw new Error("The load-test URL must be a staging Worker");
if (!Number.isInteger(userCount) || userCount < 20 || userCount > 250) throw new Error("LOAD_TEST_USERS must be between 20 and 250");
if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("Set valid load-test coordinates");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 5 }) });
const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const clientName = `Load rehearsal ${suffix}`;
const createdUserIds = [];
let clientId;

async function provision() {
  const client = await prisma.client.create({
    data: {
      name: clientName,
      workPolicy: { create: { maximumGpsAccuracy: 100 } },
      worksites: { create: { name: "Load test worksite", latitude, longitude, radiusMeters: 500, isActive: true } },
    },
  });
  clientId = client.id;

  for (let offset = 0; offset < userCount; offset += 20) {
    const batchSize = Math.min(20, userCount - offset);
    const users = await prisma.$transaction(Array.from({ length: batchSize }, (_, index) => {
      const number = offset + index + 1;
      return prisma.user.create({
        data: {
          username: `load-${suffix}-${number}`,
          passwordHash: "load-test-token-only",
          role: "EMPLOYEE",
          clientId,
          mustChangePassword: false,
          memberships: { create: { clientId, role: "EMPLOYEE" } },
          employee: { create: { firstName: "Load", lastName: `Employee ${number}`, employeeNumber: `LOAD-${number}` } },
        },
        select: { id: true, username: true },
      });
    }));
    createdUserIds.push(...users.map((user) => user.id));
  }
}

function accessToken(user) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({ sub: user.id, username: user.username, role: "EMPLOYEE", passwordVersion: 0, purpose: "ACCESS", exp: Math.floor(Date.now() / 1000) + 900 });
  const signature = createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

async function clock(user) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/v2/attendance/events/clock-in`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${accessToken(user)}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `load-${suffix}-${user.username.slice(-8)}`,
    },
    body: JSON.stringify({ location: { latitude, longitude, accuracy: 10 } }),
  });
  if (!response.ok) {
    const text = await response.text();
    let code = "UNKNOWN";
    try { code = JSON.parse(text)?.error?.code ?? JSON.parse(text)?.error ?? code; } catch { /* Keep the status-only fallback. */ }
    throw new Error(`${response.status}:${code}`);
  }
  return performance.now() - started;
}

async function cleanup() {
  let attendanceTriggerDisabled = false;
  let attendanceUpdateTriggerDisabled = false;
  let auditTriggerDisabled = false;
  try {
    await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" DISABLE TRIGGER "AttendanceEvent_immutable_delete"');
    attendanceTriggerDisabled = true;
    await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" DISABLE TRIGGER "AttendanceEvent_immutable_update"');
    attendanceUpdateTriggerDisabled = true;
    await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" DISABLE TRIGGER "AuditLog_immutable_delete"');
    auditTriggerDisabled = true;
    if (createdUserIds.length > 0) {
      await prisma.auditLog.deleteMany({ where: { actorUserId: { in: createdUserIds } } });
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    if (clientId) await prisma.client.deleteMany({ where: { id: clientId } });
  } finally {
    try {
      if (attendanceTriggerDisabled) await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" ENABLE TRIGGER "AttendanceEvent_immutable_delete"');
    } finally {
      try {
        if (attendanceUpdateTriggerDisabled) await prisma.$executeRawUnsafe('ALTER TABLE "AttendanceEvent" ENABLE TRIGGER "AttendanceEvent_immutable_update"');
      } finally {
        if (auditTriggerDisabled) await prisma.$executeRawUnsafe('ALTER TABLE "AuditLog" ENABLE TRIGGER "AuditLog_immutable_delete"');
      }
    }
  }
}

let failed = false;
try {
  await provision();
  const users = await prisma.user.findMany({ where: { id: { in: createdUserIds } }, select: { id: true, username: true } });
  const started = performance.now();
  const settled = await Promise.allSettled(users.map(clock));
  const duration = performance.now() - started;
  const latencies = settled.filter((item) => item.status === "fulfilled").map((item) => item.value).sort((a, b) => a - b);
  const failures = settled.length - latencies.length;
  const failureReasons = settled.filter((item) => item.status === "rejected").reduce((summary, item) => {
    const reason = item.reason instanceof Error ? item.reason.message : "UNKNOWN";
    summary[reason] = (summary[reason] ?? 0) + 1;
    return summary;
  }, {});
  const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? Infinity;
  console.log(JSON.stringify({ requests: settled.length, failures, durationMs: Math.round(duration), p95Ms: Math.round(p95), failureReasons }));
  failed = failures > 0 || p95 > 2_500;
} finally {
  await cleanup();
  await prisma.$disconnect();
}

if (failed) process.exitCode = 1;
