import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = process.env.D1_DRILL_SOURCE ?? "employee-attendance-staging";
const target = process.env.D1_DRILL_TARGET ?? "employee-attendance-recovery-drill";
const startedAt = new Date();
const stamp = startedAt.toISOString().replaceAll(/[:.]/g, "-");
const backupDir = path.join(root, ".tmp", "d1-recovery");
const backupPath = path.join(backupDir, `${stamp}.sql`);
const recoveryConfigPath = path.join(backupDir, `${stamp}.wrangler.json`);
const reportDir = path.join(root, "docs", "operations", "recovery-drills");
const wranglerEntry = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

function wrangler(args, capture = true) {
  const result = spawnSync(process.execPath, [wranglerEntry, ...args], { cwd: root, encoding: "utf8", stdio: capture ? "pipe" : "inherit" });
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || `Wrangler exited with ${result.status}`);
  return result.stdout ?? "";
}

function query(database, sql) {
  const output = wrangler(["d1", "execute", database, "--remote", "--command", sql, "--json"]);
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed) || !parsed[0]?.success) throw new Error(`D1 query failed for ${database}`);
  return parsed[0].results ?? [];
}

function scalar(database, sql, key) {
  return Number(query(database, sql)[0]?.[key] ?? 0);
}

function controlTotals(database) {
  return query(database, `SELECT
    (SELECT count(*) FROM "Client") AS organizations,
    (SELECT count(*) FROM "Client" WHERE "isTest" = 0) AS liveOrganizations,
    (SELECT count(*) FROM "Client" WHERE "isTest" = 1) AS testOrganizations,
    (SELECT count(*) FROM "User") AS users,
    (SELECT count(*) FROM "Employee") AS employees,
    (SELECT count(*) FROM "AttendanceRecord") AS attendanceRecords,
    (SELECT count(*) FROM "AttendanceEvent") AS attendanceEvents,
    (SELECT count(*) FROM "TimesheetDay") AS timesheetDays,
    (SELECT count(*) FROM "AuditLog") AS auditLogs,
    (SELECT max("occurredAt") FROM "AttendanceEvent") AS latestAttendanceEventAt;`)[0];
}

function applicationTables(database) {
  return query(database, "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations' ORDER BY name;").map((row) => String(row.name));
}

function foreignKeyRelationships(database) {
  return query(database, "SELECT m.name AS childTable, fk.[table] AS parentTable FROM sqlite_master AS m JOIN pragma_foreign_key_list(m.name) AS fk WHERE m.type='table' AND m.name NOT LIKE '_cf_%' AND m.name NOT LIKE 'sqlite_%' ORDER BY m.name, fk.[table];").map((row) => ({
    childTable: String(row.childTable),
    parentTable: String(row.parentTable),
  }));
}

function dependencyOrder(tables, relationships) {
  const tableSet = new Set(tables);
  const dependencies = new Map(tables.map((table) => [table, new Set()]));
  for (const { childTable, parentTable } of relationships) {
    if (childTable !== parentTable && tableSet.has(childTable) && tableSet.has(parentTable)) {
      dependencies.get(childTable)?.add(parentTable);
    }
  }

  const ordered = [];
  const remaining = new Set(tables);
  while (remaining.size > 0) {
    const ready = [...remaining].filter((table) => [...(dependencies.get(table) ?? [])].every((parent) => !remaining.has(parent))).sort();
    if (ready.length === 0) {
      throw new Error(`Could not derive a foreign-key-safe restore order for: ${[...remaining].sort().join(", ")}`);
    }
    for (const table of ready) {
      ordered.push(table);
      remaining.delete(table);
    }
  }
  return ordered;
}

function reorderDataExport(sql, orderedTables) {
  const insertsByTable = new Map();
  for (const line of sql.split(/\r?\n/)) {
    const match = line.match(/^INSERT INTO "([^"]+)"/);
    if (!match || match[1] === "d1_migrations" || match[1] === "sqlite_sequence") continue;
    const statements = insertsByTable.get(match[1]) ?? [];
    statements.push(line);
    insertsByTable.set(match[1], statements);
  }

  const unknownTables = [...insertsByTable.keys()].filter((table) => !orderedTables.includes(table));
  if (unknownTables.length > 0) throw new Error(`Export contains tables missing from the recovery schema: ${unknownTables.join(", ")}`);
  return ["PRAGMA defer_foreign_keys=TRUE;", ...orderedTables.flatMap((table) => insertsByTable.get(table) ?? [])].join("\n");
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

mkdirSync(backupDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

try {
  const sourceTablesList = applicationTables(source);
  const relationships = foreignKeyRelationships(source);
  const orderedTables = dependencyOrder(sourceTablesList, relationships);
  const targetTables = scalar(target, "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%';", "count");

  const databases = JSON.parse(wrangler(["d1", "list", "--json"]));
  const targetDatabase = databases.find((database) => database.name === target);
  if (!targetDatabase?.uuid) throw new Error(`Recovery target ${target} was not found in the Cloudflare account`);
  writeFileSync(recoveryConfigPath, JSON.stringify({
    name: "employee-attendance-recovery-drill-tools",
    compatibility_date: "2026-10-19",
    main: path.join(root, "cloudflare", "worker.ts"),
    d1_databases: [{ binding: "DB", database_name: target, database_id: targetDatabase.uuid, migrations_dir: path.join(root, "d1", "migrations") }],
  }), "utf8");
  if (targetTables === 0) {
    wrangler(["d1", "migrations", "apply", "DB", "--remote", "--config", recoveryConfigPath], false);
  } else {
    const targetTablesList = applicationTables(target);
    if (JSON.stringify(sourceTablesList) !== JSON.stringify(targetTablesList)) {
      throw new Error(`Recovery target ${target} schema does not match ${source}`);
    }
    const rootTables = sourceTablesList.filter((table) => !relationships.some(({ childTable, parentTable }) => childTable === table && childTable !== parentTable));
    const occupiedRoots = rootTables.filter((table) => scalar(target, `SELECT count(*) AS count FROM "${table}";`, "count") > 0);
    if (occupiedRoots.length > 0) {
      throw new Error(`Recovery target ${target} contains application data in: ${occupiedRoots.join(", ")}`);
    }
  }
  wrangler(["d1", "export", source, "--remote", "--output", backupPath, "--no-schema", "--skip-confirmation"], false);
  const dataOnly = reorderDataExport(readFileSync(backupPath, "utf8"), orderedTables);
  writeFileSync(backupPath, dataOnly, "utf8");
  wrangler(["d1", "execute", target, "--remote", "--file", backupPath, "--yes"], false);

  const sourceTotals = controlTotals(source);
  const restoredTotals = controlTotals(target);
  const sourceTables = scalar(source, "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations';", "count");
  const restoredTables = scalar(target, "SELECT count(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' AND name NOT LIKE 'sqlite_%' AND name != 'd1_migrations';", "count");
  const foreignKeyViolations = query(target, "PRAGMA foreign_key_check;").length;
  const integrity = String(query(target, "PRAGMA quick_check;")[0]?.quick_check ?? "unknown");
  const totalsMatch = JSON.stringify(sourceTotals) === JSON.stringify(restoredTotals);
  const passed = totalsMatch && sourceTables === restoredTables && foreignKeyViolations === 0 && integrity === "ok";
  const completedAt = new Date();
  const report = { source, target, startedAt: startedAt.toISOString(), completedAt: completedAt.toISOString(), elapsedSeconds: Math.round((completedAt.getTime() - startedAt.getTime()) / 1000), passed, sourceTables, restoredTables, foreignKeyViolations, integrity, sourceTotals, restoredTotals };
  const reportPath = path.join(reportDir, `${startedAt.toISOString().slice(0, 10)}-staging-d1.json`);
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  if (!passed) throw new Error(`Recovery drill comparison failed. Review ${reportPath}`);

  const owner = query(source, `SELECT "id" FROM "User" WHERE "isActive" = 1 AND "platformRole" = 'DEV_ADMIN' ORDER BY "createdAt" ASC LIMIT 1;`)[0];
  if (!owner?.id) throw new Error("Could not record the drill because no active platform owner was found");
  const details = JSON.stringify({ source, target, elapsedSeconds: report.elapsedSeconds, sourceTables, restoredTables, foreignKeyViolations, integrity, sourceTotals, restoredTotals });
  query(source, `INSERT INTO "AuditLog" ("id", "actorUserId", "clientId", "action", "entityType", "entityId", "details", "requestId", "ipAddress", "userAgent", "createdAt") VALUES (${quote(randomUUID())}, ${quote(owner.id)}, NULL, 'D1_RECOVERY_DRILL_PASSED', 'System', ${quote(startedAt.toISOString().slice(0, 10))}, ${quote(details)}, NULL, NULL, 'attend+ recovery drill', ${Date.now()});`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  rmSync(backupPath, { force: true });
  rmSync(recoveryConfigPath, { force: true });
}
