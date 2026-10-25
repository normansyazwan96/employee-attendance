import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import prismaInternals from "@prisma/internals";

const { getDMMF } = prismaInternals;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const prismaSchemaPath = path.join(root, "prisma", "schema.prisma");
const migrationDirectory = path.join(root, "d1", "migrations");
const drizzleSchemaPath = path.join(root, "apps", "api", "src", "d1", "schema.ts");
const source = await readFile(prismaSchemaPath, "utf8");
const datamodel = (await getDMMF({ datamodel: source })).datamodel;
const enumValues = new Map(datamodel.enums.map((item) => [item.name, item.values.map((value) => typeof value === "string" ? value : value.name)]));
const models = new Map(datamodel.models.map((model) => [model.name, model]));

function quoted(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqliteType(field) {
  if (field.isList || field.type === "Json") return "TEXT";
  if (field.kind === "enum" || field.type === "String") return "TEXT";
  if (["Int", "BigInt", "Boolean", "DateTime"].includes(field.type)) return "INTEGER";
  if (["Float", "Decimal"].includes(field.type)) return "REAL";
  if (field.type === "Bytes") return "BLOB";
  throw new Error(`Unsupported D1 type ${field.type} on ${field.name}`);
}

function sqlDefault(field) {
  if (!field.hasDefaultValue) return null;
  const value = field.default;
  if (Array.isArray(value)) return literal(JSON.stringify(value));
  if (typeof value === "string") return field.kind === "enum" || field.type === "String" ? literal(value) : value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value && typeof value === "object") {
    if (value.name === "now") return "(unixepoch() * 1000)";
    if (["cuid", "uuid", "autoincrement", "dbgenerated"].includes(value.name)) return null;
  }
  return null;
}

function sourceIndexes(modelName) {
  const block = new RegExp(`model\\s+${modelName}\\s+\\{([\\s\\S]*?)\\n\\}`, "m").exec(source)?.[1] ?? "";
  return [...block.matchAll(/@@index\(\[([^\]]+)\](?:,\s*map:\s*"([^"]+)")?\)/g)].map((match) => ({
    fields: match[1].split(",").map((value) => value.trim().split("(")[0]),
    name: match[2],
  }));
}

function indexName(prefix, tableName, fields) {
  return `${prefix}_${tableName}_${fields.join("_")}`.replace(/[^A-Za-z0-9_]/g, "_").slice(0, 120);
}

function compositeUniqueFields(model) {
  return model.uniqueFields ?? model.uniqueIndexes?.map((item) => item.fields) ?? [];
}

function createTableSql(model) {
  const tableName = model.dbName ?? model.name;
  const scalarFields = model.fields.filter((field) => field.kind !== "object");
  const definitions = scalarFields.map((field) => {
    const parts = [quoted(field.dbName ?? field.name), sqliteType(field)];
    if (field.isId) parts.push("PRIMARY KEY");
    if (field.isRequired) parts.push("NOT NULL");
    if (field.isUnique && !field.isId) parts.push("UNIQUE");
    const defaultValue = sqlDefault(field);
    if (defaultValue !== null) parts.push(`DEFAULT ${defaultValue}`);
    if (field.kind === "enum") parts.push(`CHECK (${quoted(field.dbName ?? field.name)} IN (${enumValues.get(field.type).map(literal).join(", ")}))`);
    if (field.type === "Boolean") parts.push(`CHECK (${quoted(field.dbName ?? field.name)} IN (0, 1))`);
    if (field.isList || field.type === "Json") parts.push(`CHECK (${quoted(field.dbName ?? field.name)} IS NULL OR json_valid(${quoted(field.dbName ?? field.name)}))`);
    return `  ${parts.join(" ")}`;
  });

  for (const fields of compositeUniqueFields(model)) {
    definitions.push(`  UNIQUE (${fields.map(quoted).join(", ")})`);
  }

  for (const relation of model.fields.filter((field) => field.kind === "object" && field.relationFromFields?.length)) {
    const target = models.get(relation.type);
    if (!target) throw new Error(`Missing relation target ${relation.type}`);
    const sourceFields = relation.relationFromFields;
    const targetFields = relation.relationToFields;
    const required = sourceFields.every((name) => scalarFields.find((field) => field.name === name)?.isRequired);
    const onDelete = (relation.relationOnDelete ?? (required ? "Restrict" : "SetNull")).replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase();
    definitions.push(`  FOREIGN KEY (${sourceFields.map(quoted).join(", ")}) REFERENCES ${quoted(target.dbName ?? target.name)} (${targetFields.map(quoted).join(", ")}) ON DELETE ${onDelete}`);
  }

  return `CREATE TABLE IF NOT EXISTS ${quoted(tableName)} (\n${definitions.join(",\n")}\n);`;
}

function createIndexesSql(model) {
  const tableName = model.dbName ?? model.name;
  return sourceIndexes(model.name).map((item) => {
    const name = item.name ?? indexName("idx", tableName, item.fields);
    return `CREATE INDEX IF NOT EXISTS ${quoted(name)} ON ${quoted(tableName)} (${item.fields.map(quoted).join(", ")});`;
  });
}

function tsColumn(field) {
  const columnName = JSON.stringify(field.dbName ?? field.name);
  let expression;
  if (field.isList) {
    const valueType = field.type === "Int" ? "number" : "string";
    expression = `text(${columnName}, { mode: "json" }).$type<${valueType}[]>()`;
  } else if (field.type === "Json") {
    expression = `text(${columnName}, { mode: "json" }).$type<unknown>()`;
  } else if (field.kind === "enum") {
    expression = `text(${columnName}, { enum: ${JSON.stringify(enumValues.get(field.type))} })`;
  } else if (field.type === "String") {
    expression = `text(${columnName})`;
  } else if (field.type === "Boolean") {
    expression = `integer(${columnName}, { mode: "boolean" })`;
  } else if (field.type === "DateTime") {
    expression = `integer(${columnName}, { mode: "timestamp_ms" })`;
  } else if (["Int", "BigInt"].includes(field.type)) {
    expression = `integer(${columnName})`;
  } else if (["Float", "Decimal"].includes(field.type)) {
    expression = `real(${columnName})`;
  } else if (field.type === "Bytes") {
    expression = `blob(${columnName})`;
  } else {
    throw new Error(`Unsupported Drizzle type ${field.type}`);
  }
  if (field.isId) expression += ".primaryKey()";
  if (field.isRequired) expression += ".notNull()";
  if (field.isUnique && !field.isId) expression += ".unique()";
  const value = field.default;
  if (field.hasDefaultValue && !(value && typeof value === "object" && ["cuid", "uuid", "autoincrement", "dbgenerated"].includes(value.name))) {
    if (Array.isArray(value)) expression += `.default(${JSON.stringify(value)})`;
    else if (value && typeof value === "object" && value.name === "now") expression += ".default(sql`(unixepoch() * 1000)`)";
    else if (["string", "number", "boolean"].includes(typeof value)) expression += `.default(${JSON.stringify(value)})`;
  }
  return expression;
}

function drizzleTable(model) {
  const tableName = model.dbName ?? model.name;
  const exportName = `${model.name[0].toLowerCase()}${model.name.slice(1)}Table`;
  const scalarFields = model.fields.filter((field) => field.kind !== "object");
  const extras = [];
  for (const fields of compositeUniqueFields(model)) extras.push(`uniqueIndex(${JSON.stringify(indexName("uq", tableName, fields))}).on(${fields.map((field) => `table.${field}`).join(", ")})`);
  for (const item of sourceIndexes(model.name)) extras.push(`index(${JSON.stringify(item.name ?? indexName("idx", tableName, item.fields))}).on(${item.fields.map((field) => `table.${field}`).join(", ")})`);
  const columns = scalarFields.map((field) => `  ${field.name}: ${tsColumn(field)},`).join("\n");
  const extraConfig = extras.length ? `, (table) => [\n    ${extras.join(",\n    ")},\n  ]` : "";
  return `export const ${exportName} = sqliteTable(${JSON.stringify(tableName)}, {\n${columns}\n}${extraConfig});`;
}

const migration = [
  "-- Generated from prisma/schema.prisma by scripts/d1/generate-baseline.mjs.",
  "-- DateTime values use Unix epoch milliseconds; JSON and scalar lists use JSON text.",
  "PRAGMA foreign_keys = ON;",
  ...datamodel.models.map(createTableSql),
  ...datamodel.models.flatMap(createIndexesSql),
  "",
].join("\n\n");

const scalarFields = datamodel.models.flatMap((model) => model.fields.filter((field) => field.kind !== "object"));
const sqliteImports = [
  scalarFields.some((field) => field.type === "Bytes") ? "blob" : null,
  datamodel.models.some((model) => sourceIndexes(model.name).length > 0) ? "index" : null,
  scalarFields.some((field) => ["Int", "BigInt", "Boolean", "DateTime"].includes(field.type)) ? "integer" : null,
  scalarFields.some((field) => ["Float", "Decimal"].includes(field.type)) ? "real" : null,
  "sqliteTable",
  scalarFields.some((field) => field.type === "String" || field.type === "Json" || field.kind === "enum" || field.isList) ? "text" : null,
  datamodel.models.some((model) => compositeUniqueFields(model).length > 0) ? "uniqueIndex" : null,
].filter(Boolean).sort();

const drizzleSchema = [
  "// Generated from prisma/schema.prisma by scripts/d1/generate-baseline.mjs.",
  "// Do not edit directly; update the Prisma schema and regenerate during the transition.",
  'import { sql } from "drizzle-orm";',
  `import { ${sqliteImports.join(", ")} } from "drizzle-orm/sqlite-core";`,
  "",
  ...datamodel.models.map(drizzleTable),
  "",
].join("\n\n");

await mkdir(migrationDirectory, { recursive: true });
await mkdir(path.dirname(drizzleSchemaPath), { recursive: true });
await writeFile(path.join(migrationDirectory, "0000_postgres_baseline.sql"), migration);
await writeFile(drizzleSchemaPath, drizzleSchema);
console.log(`Generated ${datamodel.models.length} D1 tables.`);
