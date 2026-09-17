import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(currentDirectory, "../../../../.env") });

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  CLIENT_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:4173"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ATTENDANCE_TIMEZONE: z.string().default("UTC"),
  WEBHOOK_URL: z.string().url().or(z.literal("")).default(""),
  WEBHOOK_SECRET: z.string().default(""),
});

export const env = schema.parse(process.env);
