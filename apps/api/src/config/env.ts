import dotenv from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { z } from "zod";

if (!process.env.DATABASE_URL && !["staging", "production"].includes(process.env.APP_ENV ?? "")) {
  const currentDirectory = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: resolve(currentDirectory, "../../../../.env") });
}

const schema = z.object({
  APP_ENV: z.enum(["development", "staging", "production", "test"]).default("development"),
  DATABASE_URL: z.string().default(""),
  PORT: z.coerce.number().int().positive().default(3000),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  CLIENT_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:4173"),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters"),
  ATTENDANCE_TIMEZONE: z.string().default("UTC"),
  WEBHOOK_URL: z.string().url().or(z.literal("")).default(""),
  WEBHOOK_SECRET: z.string().default(""),
  MFA_ENCRYPTION_KEY: z.string().default(""),
  RESEND_API_KEY: z.string().default(""),
  EMAIL_FROM: z.string().default(""),
  APP_BASE_URL: z.string().url().default("http://localhost:5173"),
  FEATURE_ATTENDANCE_V2: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  FEATURE_WORKFORCE_V2: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  FEATURE_PAYROLL: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
}).superRefine((value, context) => {
  if (value.WEBHOOK_URL && value.WEBHOOK_SECRET.length < 32) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["WEBHOOK_SECRET"],
      message: "WEBHOOK_SECRET must be at least 32 characters when WEBHOOK_URL is configured",
    });
  }
});

export const env = schema.parse(process.env);
