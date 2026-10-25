import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sourcePath = path.join(root, "prisma", "schema.prisma");
const targetPath = path.join(root, "prisma", "schema.d1.prisma");
let schema = await readFile(sourcePath, "utf8");

schema = schema.replace(
  /generator client \{[\s\S]*?\}\s*datasource db \{[\s\S]*?\}/,
  `generator client {
  provider   = "prisma-client-js"
  engineType = "client"
  output     = "../apps/api/src/generated/d1"
}

datasource db {
  provider = "sqlite"
  url      = "file:./d1.db"
}`,
);

const arrayFields = ["workDays", "exceptionCodes", "warnings", "blockingWarnings"];
for (const field of arrayFields) {
  const pattern = new RegExp(`^(\\s*)${field}\\s+(?:Int|String)\\[\\](.*)$`, "gm");
  schema = schema.replace(pattern, (_match, indentation, suffix) => {
    const withoutDefault = String(suffix).replace(/\s*@default\(\[\]\)/, "");
    return `${indentation}${field} Json${withoutDefault} @default("[]")`;
  });
}

await writeFile(targetPath, schema, "utf8");
console.log(`Generated ${path.relative(root, targetPath)} for Cloudflare D1.`);
