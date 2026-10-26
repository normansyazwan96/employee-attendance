import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./d1/drizzle",
  schema: "./apps/api/src/d1/schema.ts",
  dialect: "sqlite",
});
