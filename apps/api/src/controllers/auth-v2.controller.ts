import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { verifyPassword } from "../utils/password.js";
import { createAccessToken, verifyAccessToken, type AppRole } from "../utils/token.js";
import {
  accessTokenLifetimeSeconds,
  createAuthSession,
  hasActiveSessionAccess,
  refreshTokenLifetimeSeconds,
  revokeRefreshToken,
  rotateAuthSession,
  sessionUserInclude,
  type SessionMetadata,
  type SessionUser,
} from "../services/auth-sessions.js";
import { clearRefreshCookie, readCookie, refreshCookie, refreshCookieName } from "../utils/cookies.js";
import { recordAudit } from "../services/audit.js";
import { decryptMfaSecret, encryptMfaSecret, generateMfaSecret, generateRecoveryCodes, hashRecoveryCode, mfaUri, verifyTotp } from "../services/mfa.js";
import { env } from "../config/env.js";
import { compareAuthIdentityShadow } from "../services/d1-shadow.js";

const loginSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/).transform((value) => value.toLowerCase()),
  password: z.string().min(1),
});

const lockoutAttempts = 5;
const lockoutDurationMs = 15 * 60 * 1_000;

function metadata(request: Request): SessionMetadata {
  const userAgent = request.get("user-agent")?.slice(0, 500);
  return { ipAddress: request.ip, ...(userAgent ? { userAgent } : {}) };
}

function userView(user: SessionUser) {
  const role: AppRole = user.isGlobalAdmin ? "GLOBAL_ADMIN" : user.role;
  return {
    id: user.id,
    username: user.username,
    role,
    platformRole: user.isGlobalAdmin ? "GLOBAL_ADMIN" : user.platformRole,
    name: user.employee ? `${user.employee.firstName} ${user.employee.lastName}` : user.displayName,
    mustChangePassword: user.mustChangePassword,
    memberships: user.memberships,
  };
}

function tokenFor(user: SessionUser, sessionId: string): string {
  return createAccessToken({
    sub: user.id,
    username: user.username,
    role: user.isGlobalAdmin ? "GLOBAL_ADMIN" : user.role,
    passwordVersion: user.passwordVersion,
    sid: sessionId,
  }, accessTokenLifetimeSeconds);
}

type LoginResponseFormat = "v1" | "v2";

function sendAuthError(response: Response, status: number, code: string, message: string, format: LoginResponseFormat): void {
  response.status(status).json(format === "v1"
    ? { error: message }
    : { error: { code, message }, requestId: response.locals.requestId });
}

function sendSession(response: Response, user: SessionUser, sessionId: string, rawRefreshToken: string, format: LoginResponseFormat): void {
  response.setHeader("cache-control", "no-store");
  response.setHeader("set-cookie", refreshCookie(rawRefreshToken, refreshTokenLifetimeSeconds));
  const accessToken = tokenFor(user, sessionId);
  response.json(format === "v1"
    ? { token: accessToken, user: userView(user) }
    : { accessToken, expiresIn: accessTokenLifetimeSeconds, user: userView(user) });
}

async function completeLogin(request: Request, response: Response, user: SessionUser, format: LoginResponseFormat = "v2"): Promise<void> {
  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: new Date() } });
  const session = await createAuthSession(user.id, metadata(request));
  await recordAudit({ actorUserId: user.id, clientId: user.clientId ?? undefined, action: "LOGIN", entityType: "AuthSession", entityId: session.id, requestId: response.locals.requestId, ipAddress: request.ip, userAgent: request.get("user-agent") });
  sendSession(response, user, session.id, session.refreshToken, format);
}

async function login(request: Request, response: Response, format: LoginResponseFormat): Promise<void> {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    sendAuthError(response, 400, "INVALID_CREDENTIALS", "Enter a valid username and password", format);
    return;
  }

  const user = await prisma.user.findUnique({ where: { username: parsed.data.username }, include: sessionUserInclude });
  await compareAuthIdentityShadow(parsed.data.username, user);
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    sendAuthError(response, 423, "ACCOUNT_LOCKED", "This account is temporarily locked. Try again later.", format);
    return;
  }

  if (!user || !user.isActive || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    if (user) {
      const failed = await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: { increment: 1 } }, select: { failedLoginAttempts: true } });
      if (failed.failedLoginAttempts >= lockoutAttempts) {
        await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: new Date(Date.now() + lockoutDurationMs) } });
        await recordAudit({ actorUserId: user.id, clientId: user.clientId ?? undefined, action: "ACCOUNT_LOCKED", entityType: "User", entityId: user.id, requestId: response.locals.requestId, ipAddress: request.ip });
      }
    }
    sendAuthError(response, 401, "INVALID_CREDENTIALS", "Username or password is incorrect", format);
    return;
  }

  if (!hasActiveSessionAccess(user)) {
    sendAuthError(response, 403, "ACCOUNT_ACCESS_INACTIVE", "This account does not have an active organization membership", format);
    return;
  }

  await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  if (user.mfaCredential?.enabled) {
    const challengeToken = createAccessToken({ sub: user.id, username: user.username, role: user.isGlobalAdmin ? "GLOBAL_ADMIN" : user.role, passwordVersion: user.passwordVersion, purpose: "MFA_CHALLENGE" }, 5 * 60);
    response.setHeader("cache-control", "no-store");
    response.json({ mfaRequired: true, challengeToken });
    return;
  }
  await completeLogin(request, response, user, format);
}

export async function loginV1(request: Request, response: Response): Promise<void> {
  await login(request, response, "v1");
}

export async function loginV2(request: Request, response: Response): Promise<void> {
  await login(request, response, "v2");
}

export async function verifyMfaLoginV2(request: Request, response: Response): Promise<void> {
  const parsed = z.object({ challengeToken: z.string().min(1), code: z.string().trim().min(6).max(20) }).safeParse(request.body);
  const payload = parsed.success ? verifyAccessToken(parsed.data.challengeToken) : null;
  if (!parsed.success || !payload || payload.purpose !== "MFA_CHALLENGE") {
    response.status(401).json({ error: { code: "INVALID_MFA_CHALLENGE", message: "The verification challenge is invalid or expired" }, requestId: response.locals.requestId });
    return;
  }
  const user = await prisma.user.findUnique({ where: { id: payload.sub }, include: { ...sessionUserInclude, mfaCredential: { include: { recoveryCodes: { where: { usedAt: null } } } } } });
  if (!user?.isActive || user.passwordVersion !== payload.passwordVersion || !hasActiveSessionAccess(user) || !user.mfaCredential?.enabled) {
    response.status(401).json({ error: { code: "INVALID_MFA_CHALLENGE", message: "The verification challenge is invalid or expired" }, requestId: response.locals.requestId });
    return;
  }
  const code = parsed.data.code.replaceAll("-", "").toUpperCase();
  const validTotp = /^\d{6}$/.test(code) && verifyTotp(decryptMfaSecret(user.mfaCredential.encryptedSecret), code);
  const recovery = validTotp ? null : user.mfaCredential.recoveryCodes.find((item) => item.codeHash === hashRecoveryCode(code));
  if (!validTotp && !recovery) {
    response.status(401).json({ error: { code: "INVALID_MFA_CODE", message: "The verification code is incorrect" }, requestId: response.locals.requestId });
    return;
  }
  if (recovery) await prisma.mfaRecoveryCode.update({ where: { id: recovery.id }, data: { usedAt: new Date() } });
  await completeLogin(request, response, user);
}

export async function setupMfaV2(_request: Request, response: Response): Promise<void> {
  if (env.MFA_ENCRYPTION_KEY.length < 32) {
    response.status(503).json({ error: { code: "MFA_NOT_CONFIGURED", message: "Two-factor authentication is not configured on this deployment" }, requestId: response.locals.requestId });
    return;
  }
  if (!(["ADMIN", "MANAGER", "GLOBAL_ADMIN", "DEV_ADMIN"] as string[]).includes(response.locals.auth.role)) {
    response.status(403).json({ error: { code: "MFA_ADMIN_ONLY", message: "Two-factor authentication setup is available to administrators" }, requestId: response.locals.requestId });
    return;
  }
  const existing = await prisma.mfaCredential.findUnique({ where: { userId: response.locals.auth.sub }, select: { enabled: true } });
  if (existing?.enabled) {
    response.status(409).json({ error: { code: "MFA_ALREADY_ENABLED", message: "Two-factor authentication is already enabled" }, requestId: response.locals.requestId });
    return;
  }
  const secret = generateMfaSecret();
  await prisma.mfaCredential.upsert({
    where: { userId: response.locals.auth.sub },
    create: { userId: response.locals.auth.sub, encryptedSecret: encryptMfaSecret(secret) },
    update: { encryptedSecret: encryptMfaSecret(secret), enabled: false, verifiedAt: null, recoveryCodes: { deleteMany: {} } },
  });
  response.setHeader("cache-control", "no-store");
  response.json({ secret, uri: mfaUri(response.locals.auth.username, secret) });
}

export async function enableMfaV2(request: Request, response: Response): Promise<void> {
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(request.body);
  const credential = parsed.success ? await prisma.mfaCredential.findUnique({ where: { userId: response.locals.auth.sub } }) : null;
  if (!parsed.success || !credential || !verifyTotp(decryptMfaSecret(credential.encryptedSecret), parsed.data.code)) {
    response.status(400).json({ error: { code: "INVALID_MFA_CODE", message: "Enter the current six-digit verification code" }, requestId: response.locals.requestId });
    return;
  }
  const recoveryCodes = generateRecoveryCodes();
  await prisma.$transaction(async (transaction) => {
    await transaction.mfaCredential.update({ where: { id: credential.id }, data: { enabled: true, verifiedAt: new Date(), recoveryCodes: { deleteMany: {}, create: recoveryCodes.map((code) => ({ codeHash: hashRecoveryCode(code) })) } } });
    await transaction.auditLog.create({ data: { actorUserId: response.locals.auth.sub, action: "MFA_ENABLED", entityType: "User", entityId: response.locals.auth.sub, requestId: response.locals.requestId, ipAddress: request.ip, userAgent: request.get("user-agent") } });
  });
  response.setHeader("cache-control", "no-store");
  response.json({ recoveryCodes });
}

export async function refreshV2(request: Request, response: Response): Promise<void> {
  const rawRefreshToken = readCookie(request.headers.cookie, refreshCookieName);
  const rotated = rawRefreshToken ? await rotateAuthSession(rawRefreshToken, metadata(request)) : null;
  if (!rotated) {
    response.setHeader("set-cookie", clearRefreshCookie());
    response.status(401).json({ error: { code: "SESSION_EXPIRED", message: "Your session has expired. Please sign in again." }, requestId: response.locals.requestId });
    return;
  }
  sendSession(response, rotated.user, rotated.id, rotated.refreshToken, "v2");
}

export async function logoutV2(request: Request, response: Response): Promise<void> {
  const rawRefreshToken = readCookie(request.headers.cookie, refreshCookieName);
  const revoked = rawRefreshToken ? await revokeRefreshToken(rawRefreshToken) : null;
  response.setHeader("set-cookie", clearRefreshCookie());
  if (revoked) await recordAudit({ actorUserId: revoked.userId, clientId: revoked.clientId ?? undefined, action: "LOGOUT", entityType: "AuthSession", entityId: revoked.id, requestId: response.locals.requestId, ipAddress: request.ip, userAgent: request.get("user-agent") });
  response.status(204).end();
}

export async function listSessionsV2(_request: Request, response: Response): Promise<void> {
  const sessions = await prisma.authSession.findMany({
    where: { userId: response.locals.auth.sub, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { lastUsedAt: "desc" },
    select: { id: true, createdAt: true, lastUsedAt: true, expiresAt: true, ipAddress: true, userAgent: true },
  });
  response.setHeader("cache-control", "private, no-store");
  response.json({ data: sessions.map((session) => ({ ...session, current: session.id === response.locals.auth.sid })) });
}

export async function revokeSessionV2(request: Request, response: Response): Promise<void> {
  const sessionId = Array.isArray(request.params.id) ? request.params.id[0] : request.params.id;
  const revoked = await prisma.authSession.updateMany({
    where: { id: sessionId, userId: response.locals.auth.sub, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count === 0) {
    response.status(404).json({ error: { code: "SESSION_NOT_FOUND", message: "Active session not found" }, requestId: response.locals.requestId });
    return;
  }
  if (sessionId === response.locals.auth.sid) response.setHeader("set-cookie", clearRefreshCookie());
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: response.locals.currentClientId, action: "SESSION_REVOKED", entityType: "AuthSession", entityId: sessionId, details: { current: sessionId === response.locals.auth.sid }, requestId: response.locals.requestId, ipAddress: request.ip, userAgent: request.get("user-agent") });
  response.status(204).end();
}
