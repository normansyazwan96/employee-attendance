import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { prisma } from "../services/prisma.js";
import { verifyAccessToken } from "../utils/token.js";

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
  const [user, authSession] = await Promise.all([
    prisma.user.findUnique({ where: { id: response.locals.auth.sub }, select: { isActive: true, passwordVersion: true, mustChangePassword: true } }),
    response.locals.auth.sid
      ? prisma.authSession.findUnique({ where: { id: response.locals.auth.sid }, select: { userId: true, revokedAt: true, expiresAt: true } })
      : Promise.resolve(null),
  ]);
  const sessionInvalid = response.locals.auth.sid && (
    !authSession
    || authSession.userId !== response.locals.auth.sub
    || authSession.revokedAt !== null
    || authSession.expiresAt <= new Date()
  );
  if (!user?.isActive || user.passwordVersion !== response.locals.auth.passwordVersion || sessionInvalid) {
    response.status(401).json({ error: "Your session has expired. Please sign in again." });
    return;
  }
  response.locals.mustChangePassword = user.mustChangePassword;
  next();
};

export const requirePasswordChangeCompleted: RequestHandler = (_request, response, next) => {
  if (response.locals.mustChangePassword) {
    response.status(403).json({ error: "You must change your temporary password before continuing", code: "PASSWORD_CHANGE_REQUIRED" });
    return;
  }
  next();
};

export function requireRoles(...roles: Role[]): RequestHandler {
  return (_request, response, next) => {
    if (!roles.includes(response.locals.auth.role as Role)) { response.status(403).json({ error: "You do not have access to this resource" }); return; }
    next();
  };
}
