import type { RequestHandler } from "express";
import type { Role } from "@prisma/client";
import { verifyAccessToken } from "../utils/token.js";

export const requireAuth: RequestHandler = (request, response, next) => {
  const token = request.header("authorization")?.replace(/^Bearer\s+/i, "");
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) { response.status(401).json({ error: "Authentication is required" }); return; }
  response.locals.auth = payload;
  next();
};

export function requireRoles(...roles: Role[]): RequestHandler {
  return (_request, response, next) => {
    if (!roles.includes(response.locals.auth.role as Role)) { response.status(403).json({ error: "You do not have access to this resource" }); return; }
    next();
  };
}
