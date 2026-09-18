import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";

export type AuthTokenPayload = { sub: string; role: "EMPLOYEE" | "ADMIN" | "DEV_ADMIN"; username: string; passwordVersion: number; exp: number };
const tokenPayloadSchema = z.object({ sub: z.string().min(1), username: z.string().min(3).max(40), role: z.enum(["EMPLOYEE", "ADMIN", "DEV_ADMIN"]), passwordVersion: z.number().int().nonnegative(), exp: z.number().int().positive() });
const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString("base64url");
const signature = (input: string): string => createHmac("sha256", env.JWT_SECRET).update(input).digest("base64url");

export function createAccessToken(payload: Omit<AuthTokenPayload, "exp" | "passwordVersion"> & { passwordVersion?: number }): string {
  const header = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({ ...payload, passwordVersion: payload.passwordVersion ?? 0, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8 });
  return `${header}.${body}.${signature(`${header}.${body}`)}`;
}

export function verifyAccessToken(token: string): AuthTokenPayload | null {
  const [header, body, tokenSignature] = token.split(".");
  if (!header || !body || !tokenSignature) return null;
  const expected = signature(`${header}.${body}`);
  if (expected.length !== tokenSignature.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(tokenSignature))) return null;
  try {
    const parsed = tokenPayloadSchema.safeParse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
    if (!parsed.success || parsed.data.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed.data;
  } catch { return null; }
}
