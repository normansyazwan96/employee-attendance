import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(await readFile(path.join(root, "d1", "data", "staging-manifest.json"), "utf8"));
const tableNames = Object.keys(manifest.tables);
const sql = `${tableNames.map((name) => `SELECT '${name.replaceAll("'", "''")}' AS tableName, count(*) AS rowCount FROM "${name.replaceAll('"', '""')}"`).join("; ")};`;
const wrangler = path.join(root, "node_modules", "wrangler", "wrangler-dist", "cli.js");
const result = spawnSync(process.execPath, [wrangler, "d1", "execute", "DB", "--remote", "--config", "wrangler.d1.jsonc", "--env", "staging", "--json", "--command", sql], { cwd: root, encoding: "utf8" });
if (result.status !== 0) throw new Error(result.error?.message || result.stderr || result.stdout || "Unable to query staging D1");
const output = JSON.parse(result.stdout);
const rows = output.flatMap((item) => item.results ?? []);
const actual = new Map(rows.map((row) => [row.tableName, Number(row.rowCount)]));
const mismatches = tableNames.filter((name) => actual.get(name) !== manifest.tables[name].rows).map((name) => ({ table: name, source: manifest.tables[name].rows, d1: actual.get(name) ?? null }));
if (mismatches.length > 0) {
  console.error(JSON.stringify(mismatches, null, 2));
  process.exitCode = 1;
} else {
  console.log(`Reconciled ${tableNames.length} tables and ${rows.reduce((sum, row) => sum + Number(row.rowCount), 0)} rows.`);
}
