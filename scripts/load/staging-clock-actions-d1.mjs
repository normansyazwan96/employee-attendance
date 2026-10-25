import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const baseUrl = process.env.LOAD_TEST_BASE_URL?.replace(/\/$/, "");
const jwtSecret = process.env.LOAD_TEST_JWT_SECRET;
const confirmation = process.env.LOAD_TEST_CONFIRM;
const userCount = Number(process.env.LOAD_TEST_USERS ?? "100");
const latitude = Number(process.env.LOAD_TEST_LATITUDE ?? "3.139");
const longitude = Number(process.env.LOAD_TEST_LONGITUDE ?? "101.6869");
const wranglerEntry = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const stagingConfig = path.join(root, "wrangler.d1.jsonc");
const tempDirectory = path.join(root, ".tmp", "d1-load-rehearsal");

if (!baseUrl || !jwtSecret) throw new Error("Set LOAD_TEST_BASE_URL and LOAD_TEST_JWT_SECRET");
if (jwtSecret.length < 32) throw new Error("LOAD_TEST_JWT_SECRET must be at least 32 characters");
if (confirmation !== "STAGING_ONLY") throw new Error("Set LOAD_TEST_CONFIRM=STAGING_ONLY to allow temporary staging data");
if (!new URL(baseUrl).hostname.includes("-staging.")) throw new Error("The load-test URL must be a staging Worker");
if (!Number.isInteger(userCount) || userCount < 20 || userCount > 250) throw new Error("LOAD_TEST_USERS must be between 20 and 250");
if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) throw new Error("Set valid load-test coordinates");

const suffix = `${Date.now()}-${randomBytes(4).toString("hex")}`;
const clientId = randomUUID();
const clientName = `Load rehearsal ${suffix}`;
const worksiteId = randomUUID();
const workPolicyId = randomUUID();
const users = Array.from({ length: userCount }, (_, index) => ({
  userId: randomUUID(),
  employeeId: randomUUID(),
  membershipId: randomUUID(),
  sessionId: randomUUID(),
  username: `load-${suffix}-${index + 1}`,
  employeeNumber: `LOAD-${suffix.slice(-8)}-${index + 1}`,
}));

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function wrangler(args, capture = true) {
  const result = spawnSync(process.execPath, [wranglerEntry, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || `Wrangler exited with ${result.status}`);
  return result.stdout ?? "";
}

function query(sql) {
  const output = wrangler(["d1", "execute", "DB", "--remote", "--config", stagingConfig, "--env", "staging", "--json", "--command", sql]);
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || !parsed[0]?.success) throw new Error("Staging D1 query failed");
  return parsed.flatMap((item) => item.results ?? []);
}

function executeFile(filePath) {
  wrangler(["d1", "execute", "DB", "--remote", "--config", stagingConfig, "--env", "staging", "--file", filePath, "--yes"], false);
}

function accessToken(user) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({
    sub: user.userId,
    username: user.username,
    role: "EMPLOYEE",
    passwordVersion: 0,
    sid: user.sessionId,
    purpose: "ACCESS",
    exp: Math.floor(Date.now() / 1000) + 900,
  });
  const signature = createHmac("sha256", jwtSecret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

function provisionSql() {
  const now = Date.now();
  const expiresAt = now + 60 * 60 * 1000;
  const statements = [
    "PRAGMA foreign_keys = ON;",
    `INSERT INTO "Client" ("id", "name", "stateCode", "createdAt", "updatedAt", "isTest") VALUES (${sqlText(clientId)}, ${sqlText(clientName)}, '14', ${now}, ${now}, 1);`,
    `INSERT INTO "WorkPolicy" ("id", "clientId", "gracePeriodMinutes", "defaultBreakMinutes", "roundingIncrement", "overtimeThreshold", "maximumShiftMinutes", "missedClockOutMinutes", "maximumGpsAccuracy", "exactGpsRetentionDays", "createdAt", "updatedAt") VALUES (${sqlText(workPolicyId)}, ${sqlText(clientId)}, 10, 60, 1, 480, 960, 960, 100, 90, ${now}, ${now});`,
    `INSERT INTO "Worksite" ("id", "clientId", "ownerAdminId", "name", "latitude", "longitude", "radiusMeters", "isActive", "createdAt", "updatedAt", "stateCode") VALUES (${sqlText(worksiteId)}, ${sqlText(clientId)}, NULL, 'Load test worksite', ${latitude}, ${longitude}, 500, 1, ${now}, ${now}, '14');`,
  ];

  for (const [index, user] of users.entries()) {
    statements.push(
      `INSERT INTO "User" ("id", "username", "passwordHash", "passwordVersion", "mustChangePassword", "role", "platformRole", "isActive", "failedLoginAttempts", "displayName", "clientId", "createdAt", "updatedAt", "isGlobalAdmin") VALUES (${sqlText(user.userId)}, ${sqlText(user.username)}, 'load-test-token-only', 0, 0, 'EMPLOYEE', 'USER', 1, 0, ${sqlText(`Load Employee ${index + 1}`)}, ${sqlText(clientId)}, ${now}, ${now}, 0);`,
      `INSERT INTO "OrganizationMembership" ("id", "userId", "clientId", "role", "status", "canManagePayroll", "createdAt", "updatedAt") VALUES (${sqlText(user.membershipId)}, ${sqlText(user.userId)}, ${sqlText(clientId)}, 'EMPLOYEE', 'ACTIVE', 0, ${now}, ${now});`,
      `INSERT INTO "Employee" ("id", "firstName", "lastName", "userId", "employeeNumber", "employmentStatus", "createdAt", "updatedAt") VALUES (${sqlText(user.employeeId)}, 'Load', ${sqlText(`Employee ${index + 1}`)}, ${sqlText(user.userId)}, ${sqlText(user.employeeNumber)}, 'ACTIVE', ${now}, ${now});`,
      `INSERT INTO "AuthSession" ("id", "userId", "refreshTokenHash", "familyId", "expiresAt", "lastUsedAt", "createdAt", "updatedAt") VALUES (${sqlText(user.sessionId)}, ${sqlText(user.userId)}, ${sqlText(randomBytes(32).toString("hex"))}, ${sqlText(randomUUID())}, ${expiresAt}, ${now}, ${now}, ${now});`,
    );
  }
  return statements.join("\n");
}

function cleanupSql(removeAllRehearsals = false) {
  const clientPredicate = removeAllRehearsals
    ? '"name" LIKE \'Load rehearsal %\' AND "isTest" = 1'
    : `"id" = ${sqlText(clientId)} AND "name" = ${sqlText(clientName)} AND "isTest" = 1`;
  const userPredicate = removeAllRehearsals
    ? '"username" LIKE \'load-%\' AND "passwordHash" = \'load-test-token-only\''
    : `"username" LIKE ${sqlText(`load-${suffix}-%`)} AND "passwordHash" = 'load-test-token-only'`;
  return `PRAGMA foreign_keys = ON;
DROP TRIGGER IF EXISTS "AttendanceEvent_immutable_update";
DROP TRIGGER IF EXISTS "AttendanceEvent_immutable_delete";
DROP TRIGGER IF EXISTS "AuditLog_immutable_delete";
DELETE FROM "AuditLog" WHERE "clientId" IN (SELECT "id" FROM "Client" WHERE ${clientPredicate}) OR "actorUserId" IN (SELECT "id" FROM "User" WHERE ${userPredicate});
DELETE FROM "User" WHERE ${userPredicate};
DELETE FROM "Client" WHERE ${clientPredicate};
CREATE TRIGGER IF NOT EXISTS "AuditLog_immutable_delete"
BEFORE DELETE ON "AuditLog"
BEGIN
  SELECT RAISE(ABORT, 'AuditLog rows are immutable');
END;
CREATE TRIGGER IF NOT EXISTS "AttendanceEvent_immutable_update"
BEFORE UPDATE ON "AttendanceEvent"
WHEN NOT (
  NEW."id" IS OLD."id"
  AND NEW."employeeId" IS OLD."employeeId"
  AND NEW."clientId" IS OLD."clientId"
  AND NEW."workDate" IS OLD."workDate"
  AND NEW."type" IS OLD."type"
  AND NEW."source" IS OLD."source"
  AND NEW."occurredAt" IS OLD."occurredAt"
  AND NEW."worksiteId" IS OLD."worksiteId"
  AND NEW."distanceMeters" IS OLD."distanceMeters"
  AND NEW."acceptedRadiusMeters" IS OLD."acceptedRadiusMeters"
  AND NEW."idempotencyKey" IS OLD."idempotencyKey"
  AND NEW."createdByUserId" IS OLD."createdByUserId"
  AND NEW."deviceDetails" IS OLD."deviceDetails"
  AND NEW."createdAt" IS OLD."createdAt"
)
OR (NEW."latitude" IS NOT OLD."latitude" AND NEW."latitude" IS NOT NULL)
OR (NEW."longitude" IS NOT OLD."longitude" AND NEW."longitude" IS NOT NULL)
OR (NEW."accuracyMeters" IS NOT OLD."accuracyMeters" AND NEW."accuracyMeters" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'AttendanceEvent facts are immutable');
END;
CREATE TRIGGER IF NOT EXISTS "AttendanceEvent_immutable_delete"
BEFORE DELETE ON "AttendanceEvent"
BEGIN
  SELECT RAISE(ABORT, 'AttendanceEvent rows are immutable');
END;`;
}

async function clock(user) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/api/v2/attendance/events/clock-in`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
    headers: {
      Authorization: `Bearer ${accessToken(user)}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `load-${suffix}-${user.userId}`,
    },
    body: JSON.stringify({ location: { latitude, longitude, accuracy: 10 } }),
  });
  if (!response.ok) {
    const responseText = await response.text();
    let code = "UNKNOWN";
    try {
      const parsed = JSON.parse(responseText);
      code = parsed?.error?.code ?? parsed?.code ?? parsed?.error ?? code;
    } catch {
      // The status remains useful when an upstream response is not JSON.
    }
    throw new Error(`${response.status}:${code}`);
  }
  return performance.now() - started;
}

mkdirSync(tempDirectory, { recursive: true });
const provisionPath = path.join(tempDirectory, `${suffix}-provision.sql`);
const cleanupPath = path.join(tempDirectory, `${suffix}-cleanup.sql`);
let failed = false;

try {
  const staleRehearsals = Number(query('SELECT (SELECT count(*) FROM "Client" WHERE "name" LIKE \'Load rehearsal %\' AND "isTest" = 1) + (SELECT count(*) FROM "User" WHERE "username" LIKE \'load-%\' AND "passwordHash" = \'load-test-token-only\') AS total;')[0]?.total ?? 0);
  if (staleRehearsals > 0) {
    writeFileSync(cleanupPath, cleanupSql(true), "utf8");
    executeFile(cleanupPath);
  }
  writeFileSync(provisionPath, provisionSql(), "utf8");
  executeFile(provisionPath);
  const provisioned = Number(query(`SELECT count(*) AS total FROM "User" WHERE "clientId" = ${sqlText(clientId)};`)[0]?.total ?? 0);
  if (provisioned !== userCount) throw new Error(`Expected ${userCount} temporary users, found ${provisioned}`);

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
  const createdEvents = Number(query(`SELECT count(*) AS total FROM "AttendanceEvent" WHERE "clientId" = ${sqlText(clientId)} AND "type" = 'CLOCK_IN';`)[0]?.total ?? 0);
  const p95 = latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? Infinity;
  const report = { requests: settled.length, failures, createdEvents, durationMs: Math.round(duration), p95Ms: Math.round(p95), failureReasons };
  console.log(JSON.stringify(report));
  failed = failures > 0 || createdEvents !== userCount || p95 > 2_500;
} finally {
  try {
    writeFileSync(cleanupPath, cleanupSql(), "utf8");
    executeFile(cleanupPath);
    const remaining = Number(query(`SELECT count(*) AS total FROM "Client" WHERE "id" = ${sqlText(clientId)};`)[0]?.total ?? 0);
    const immutableGuards = Number(query("SELECT count(*) AS total FROM sqlite_master WHERE type = 'trigger' AND name IN ('AttendanceEvent_immutable_update', 'AttendanceEvent_immutable_delete', 'AuditLog_immutable_delete');")[0]?.total ?? 0);
    if (remaining !== 0 || immutableGuards !== 3) throw new Error("Temporary load data was not fully removed or immutable guards were not restored");
  } finally {
    rmSync(provisionPath, { force: true });
    rmSync(cleanupPath, { force: true });
  }
}

if (failed) process.exitCode = 1;
