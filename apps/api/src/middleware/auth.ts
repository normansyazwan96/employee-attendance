import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { prisma } from "../services/prisma.js";
import { hasActiveSessionAccess } from "../services/auth-sessions.js";
import { verifyAccessToken, type AppRole } from "../utils/token.js";

function effectiveRole(user: { role: Role; isGlobalAdmin: boolean }): AppRole {
  return user.isGlobalAdmin ? "GLOBAL_ADMIN" : user.role;
}

export const requireAuth: RequestHandler = (request, response, next) => {
  const token = request.header("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload || payload.purpose === "MFA_CHALLENGE") { response.status(401).json({ error: "Authentication is required" }); return; }
  response.locals.auth = payload;
  const requestedOrganizationId = request.header("x-organization-id")?.trim();
  response.locals.requestedOrganizationId = requestedOrganizationId && /^[A-Za-z0-9_-]{1,128}$/.test(requestedOrganizationId) ? requestedOrganizationId : undefined;
  next();
};

export const requireCurrentSession: RequestHandler = async (_request, response, next) => {
  if (!response.locals.auth.sid) {
    response.status(401).json({ error: "Your session has expired. Please sign in again." });
    return;
  }
  const [user, authSession] = await Promise.all([
    prisma.user.findUnique({
      where: { id: response.locals.auth.sub },
      select: {
        isActive: true,
        passwordVersion: true,
        mustChangePassword: true,
        role: true,
        isGlobalAdmin: true,
        clientId: true,
        memberships: { where: { status: "ACTIVE" }, select: { clientId: true, role: true } },
      },
    }),
    prisma.authSession.findUnique({ where: { id: response.locals.auth.sid }, select: { userId: true, revokedAt: true, expiresAt: true } }),
  ]);
  const sessionInvalid = (
    !authSession
    || authSession.userId !== response.locals.auth.sub
    || authSession.revokedAt !== null
    || authSession.expiresAt <= new Date()
  );
  if (!user?.isActive || user.passwordVersion !== response.locals.auth.passwordVersion || effectiveRole(user) !== response.locals.auth.role || !hasActiveSessionAccess(user) || sessionInvalid) {
    response.status(401).json({ error: "Your session has expired. Please sign in again." });
    return;
  }
  response.locals.mustChangePassword = user.mustChangePassword;
  response.locals.currentClientId = user.clientId;
  next();
};

export const requirePasswordChangeCompleted: RequestHandler = (_request, response, next) => {
  if (response.locals.mustChangePassword) {
    response.status(403).json({ error: "You must change your temporary password before continuing", code: "PASSWORD_CHANGE_REQUIRED" });
    return;
  }
  next();
};

export function requireRoles(...roles: AppRole[]): RequestHandler {
  return (_request, response, next) => {
    if (!roles.includes(response.locals.auth.role as AppRole)) { response.status(403).json({ error: "You do not have access to this resource" }); return; }
    next();
  };
}
