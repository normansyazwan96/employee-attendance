import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import prismaInternals from "@prisma/internals";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const { getDMMF } = prismaInternals;
const scrypt = promisify(scryptCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required to preserve devadmin");

const outputDirectory = path.join(root, "d1", "data");
const sqlPath = path.join(outputDirectory, "clean-seed.sql");
const credentialsPath = path.join(outputDirectory, "clean-seed-credentials.json");
const prismaSchema = await readFile(path.join(root, "prisma", "schema.prisma"), "utf8");
const guardSql = await readFile(path.join(root, "d1", "migrations", "0001_immutable_guards.sql"), "utf8");
const datamodel = (await getDMMF({ datamodel: prismaSchema })).datamodel;
const modelByName = new Map(datamodel.models.map((model) => [model.name, model]));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 1 }) });

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlValue(value) {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return String(value.getTime());
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function insert(table, values) {
  const columns = Object.keys(values).map(quoteIdentifier).join(", ");
  const serialized = Object.values(values).map(sqlValue).join(", ");
  return `INSERT INTO ${quoteIdentifier(table)} (${columns}) VALUES (${serialized});`;
}

function dependencyOrder() {
  const remaining = new Map(datamodel.models.map((model) => [model.name, new Set(
    model.fields
      .filter((field) => field.kind === "object" && field.relationFromFields?.length && field.type !== model.name)
      .map((field) => field.type)
      .filter((name) => modelByName.has(name)),
  )]));
  const ordered = [];
  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, dependencies]) => [...dependencies].every((name) => !remaining.has(name)))
      .map(([name]) => name)
      .sort();
    if (ready.length === 0) throw new Error(`Cross-table relation cycle: ${[...remaining.keys()].join(", ")}`);
    for (const name of ready) {
      ordered.push(name);
      remaining.delete(name);
    }
  }
  return ordered;
}

function password() {
  return `Aa1!${randomBytes(10).toString("base64url")}`;
}

async function hashPassword(value) {
  const salt = randomBytes(16).toString("hex");
  const key = await scrypt(value, salt, 64);
  return `${salt}:${Buffer.from(key).toString("hex")}`;
}

const devadmin = await prisma.user.findUnique({ where: { username: "devadmin" } });
if (!devadmin || devadmin.role !== "DEV_ADMIN") throw new Error("An active devadmin source account is required");

const now = Date.now();
const organizations = [
  {
    id: "aurora-services",
    name: "Aurora Services",
    admin: { username: "aurora.admin", displayName: "Aurora Administrator" },
    employees: [
      { username: "aurora.employee1", firstName: "Aina", lastName: "Rahman", number: "AUR-001" },
      { username: "aurora.employee2", firstName: "Faris", lastName: "Ismail", number: "AUR-002" },
    ],
  },
  {
    id: "meridian-works",
    name: "Meridian Works",
    admin: { username: "meridian.admin", displayName: "Meridian Administrator" },
    employees: [
      { username: "meridian.employee1", firstName: "Mei Lin", lastName: "Tan", number: "MER-001" },
      { username: "meridian.employee2", firstName: "Daniel", lastName: "Lee", number: "MER-002" },
    ],
  },
];

const credentials = [];
const statements = [
  "PRAGMA foreign_keys = OFF;",
  'DROP TRIGGER IF EXISTS "AuditLog_immutable_update";',
  'DROP TRIGGER IF EXISTS "AuditLog_immutable_delete";',
  'DROP TRIGGER IF EXISTS "AttendanceEvent_immutable_update";',
  'DROP TRIGGER IF EXISTS "AttendanceEvent_immutable_delete";',
  'DROP TRIGGER IF EXISTS "PayrollMonetaryAdjustment_immutable_update";',
  'DROP TRIGGER IF EXISTS "PayrollMonetaryAdjustment_immutable_delete";',
  'DROP TRIGGER IF EXISTS "PayrollMonetaryAdjustmentDecision_immutable_update";',
  'DROP TRIGGER IF EXISTS "PayrollMonetaryAdjustmentDecision_immutable_delete";',
  'DROP TRIGGER IF EXISTS "PayrollStatementDelivery_immutable_update";',
  'DROP TRIGGER IF EXISTS "PayrollStatementDelivery_immutable_delete";',
  ...dependencyOrder().reverse().map((name) => `DELETE FROM ${quoteIdentifier(name)};`),
  insert("User", {
    id: devadmin.id,
    username: devadmin.username,
    email: devadmin.email,
    passwordHash: devadmin.passwordHash,
    passwordVersion: devadmin.passwordVersion,
    mustChangePassword: devadmin.mustChangePassword,
    role: "DEV_ADMIN",
    platformRole: "DEV_ADMIN",
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    displayName: devadmin.displayName,
    clientId: null,
    createdByUserId: null,
    createdAt: devadmin.createdAt,
    updatedAt: new Date(now),
  }),
];

for (const organization of organizations) {
  const adminId = randomUUID();
  const adminPassword = password();
  credentials.push({ username: organization.admin.username, password: adminPassword, role: "ADMIN", organization: organization.name });
  statements.push(insert("Client", { id: organization.id, name: organization.name, stateCode: null, createdAt: now, updatedAt: now }));
  statements.push(insert("WorkPolicy", { id: randomUUID(), clientId: organization.id, createdAt: now, updatedAt: now }));
  for (const leaveType of [
    { code: "ANNUAL", name: "Annual Leave", isPaid: true, defaultEntitlementMinutes: 6_720 },
    { code: "SICK", name: "Sick Leave", isPaid: true, defaultEntitlementMinutes: 6_720 },
    { code: "UNPAID", name: "Unpaid Leave", isPaid: false, defaultEntitlementMinutes: 0 },
  ]) {
    statements.push(insert("LeaveType", { id: randomUUID(), clientId: organization.id, ...leaveType, isActive: true, createdAt: now, updatedAt: now }));
  }
  statements.push(insert("User", {
    id: adminId,
    username: organization.admin.username,
    email: null,
    passwordHash: await hashPassword(adminPassword),
    passwordVersion: 0,
    mustChangePassword: false,
    role: "ADMIN",
    platformRole: "USER",
    isActive: true,
    failedLoginAttempts: 0,
    lockedUntil: null,
    lastLoginAt: null,
    displayName: organization.admin.displayName,
    clientId: organization.id,
    createdByUserId: devadmin.id,
    createdAt: now,
    updatedAt: now,
  }));
  statements.push(insert("OrganizationMembership", { id: randomUUID(), userId: adminId, clientId: organization.id, role: "ADMIN", status: "ACTIVE", managerMembershipId: null, canManagePayroll: true, createdAt: now, updatedAt: now }));

  for (const employee of organization.employees) {
    const userId = randomUUID();
    const employeePassword = password();
    credentials.push({ username: employee.username, password: employeePassword, role: "EMPLOYEE", organization: organization.name });
    statements.push(insert("User", {
      id: userId,
      username: employee.username,
      email: null,
      passwordHash: await hashPassword(employeePassword),
      passwordVersion: 0,
      mustChangePassword: false,
      role: "EMPLOYEE",
      platformRole: "USER",
      isActive: true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: null,
      displayName: null,
      clientId: organization.id,
      createdByUserId: adminId,
      createdAt: now,
      updatedAt: now,
    }));
    statements.push(insert("Employee", { id: randomUUID(), firstName: employee.firstName, lastName: employee.lastName, userId, employeeNumber: employee.number, employmentStatus: "ACTIVE", joinDate: now, terminationDate: null, departmentId: null, managerEmployeeId: null, createdAt: now, updatedAt: now }));
    statements.push(insert("OrganizationMembership", { id: randomUUID(), userId, clientId: organization.id, role: "EMPLOYEE", status: "ACTIVE", managerMembershipId: null, canManagePayroll: false, createdAt: now, updatedAt: now }));
  }
}

statements.push("PRAGMA foreign_keys = ON;");
statements.push(guardSql.trim());

await mkdir(outputDirectory, { recursive: true });
await writeFile(sqlPath, `${statements.join("\n")}\n`, "utf8");
await writeFile(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, "utf8");
await prisma.$disconnect();
console.log(`Generated a clean D1 seed with ${1 + credentials.length} users across ${organizations.length} organizations.`);
