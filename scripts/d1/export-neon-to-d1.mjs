import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prismaInternals from "@prisma/internals";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const { getDMMF } = prismaInternals;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const outputDirectory = path.join(root, "d1", "data");
const sqlPath = path.join(outputDirectory, "staging-import.sql");
const manifestPath = path.join(outputDirectory, "staging-manifest.json");
const prismaSchema = await readFile(path.join(root, "prisma", "schema.prisma"), "utf8");
const datamodel = (await getDMMF({ datamodel: prismaSchema })).datamodel;
const modelByName = new Map(datamodel.models.map((model) => [model.name, model]));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString, max: 2 }) });

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function sqlValue(value, field) {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return String(value.getTime());
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Non-finite value in ${field.name}`);
    return String(value);
  }
  const serialized = field.isList || field.type === "Json" || typeof value === "object" ? JSON.stringify(value) : String(value);
  return `'${serialized.replaceAll("'", "''")}'`;
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
    const ready = [...remaining.entries()].filter(([, dependencies]) => [...dependencies].every((name) => !remaining.has(name))).map(([name]) => name).sort();
    if (ready.length === 0) throw new Error(`Cross-table relation cycle: ${[...remaining.keys()].join(", ")}`);
    for (const name of ready) {
      ordered.push(modelByName.get(name));
      remaining.delete(name);
    }
  }
  return ordered;
}

function selfReferenceFields(model) {
  return new Set(model.fields
    .filter((field) => field.kind === "object" && field.type === model.name && field.relationFromFields?.length)
    .flatMap((field) => field.relationFromFields));
}

async function readRows(model) {
  const accessor = `${model.name[0].toLowerCase()}${model.name.slice(1)}`;
  const delegate = prisma[accessor];
  if (!delegate?.findMany) throw new Error(`Prisma delegate ${accessor} is unavailable`);
  const rows = [];
  let cursor;
  do {
    const page = await delegate.findMany({
      take: 500,
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    rows.push(...page);
    cursor = page.at(-1)?.id;
    if (page.length < 500) break;
  } while (cursor);
  return rows;
}

try {
  const statements = [
    "-- Generated staging copy. Contains authentication hashes and must never be committed.",
    "PRAGMA foreign_keys = ON;",
  ];
  const manifest = { generatedAt: new Date().toISOString(), tables: {} };
  const deferredSelfUpdates = [];

  for (const model of dependencyOrder()) {
    const rows = await readRows(model);
    const fields = model.fields.filter((field) => field.kind !== "object");
    const selfFields = selfReferenceFields(model);
    const tableName = model.dbName ?? model.name;
    const digest = createHash("sha256");
    for (const row of rows) {
      digest.update(JSON.stringify(row, (_key, value) => value instanceof Date ? value.toISOString() : typeof value === "bigint" ? value.toString() : value));
      const values = fields.map((field) => sqlValue(selfFields.has(field.name) ? null : row[field.name], field));
      statements.push(`INSERT INTO ${quoteIdentifier(tableName)} (${fields.map((field) => quoteIdentifier(field.dbName ?? field.name)).join(", ")}) VALUES (${values.join(", ")});`);
      for (const field of fields.filter((item) => selfFields.has(item.name) && row[item.name] !== null)) {
        deferredSelfUpdates.push(`UPDATE ${quoteIdentifier(tableName)} SET ${quoteIdentifier(field.dbName ?? field.name)} = ${sqlValue(row[field.name], field)} WHERE "id" = ${sqlValue(row.id, fields.find((item) => item.name === "id"))};`);
      }
    }
    manifest.tables[model.name] = { rows: rows.length, sha256: digest.digest("hex") };
  }

  statements.push(...deferredSelfUpdates, "");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(sqlPath, statements.join("\n"));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Prepared ${Object.values(manifest.tables).reduce((sum, table) => sum + table.rows, 0)} rows across ${Object.keys(manifest.tables).length} tables.`);
  console.log(sqlPath);
  console.log(manifestPath);
} finally {
  await prisma.$disconnect();
}
