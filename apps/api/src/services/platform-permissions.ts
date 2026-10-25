import type { RequestHandler } from "express";
import type { AppRole } from "../utils/token.js";

export const platformPermissions = [
  "PLATFORM_ORGANIZATIONS_READ",
  "PLATFORM_ORGANIZATIONS_WRITE",
  "PLATFORM_ADMINS_READ",
  "PLATFORM_ADMINS_WRITE",
  "PLATFORM_GLOBAL_ADMINS_MANAGE",
  "PLATFORM_AUDIT_READ",
  "PLATFORM_SYSTEM_READ",
  "TENANT_OPERATIONS",
] as const;

export type PlatformPermission = (typeof platformPermissions)[number];

const permissionsByRole: Record<AppRole, ReadonlySet<PlatformPermission>> = {
  EMPLOYEE: new Set(),
  MANAGER: new Set(["TENANT_OPERATIONS"]),
  ADMIN: new Set(["PLATFORM_ORGANIZATIONS_READ", "TENANT_OPERATIONS"]),
  GLOBAL_ADMIN: new Set(["PLATFORM_ORGANIZATIONS_READ", "PLATFORM_ADMINS_READ"]),
  DEV_ADMIN: new Set(platformPermissions),
};

export function hasPlatformPermission(role: AppRole, permission: PlatformPermission): boolean {
  return permissionsByRole[role].has(permission);
}

export function requirePlatformPermission(permission: PlatformPermission): RequestHandler {
  return (_request, response, next) => {
    if (!hasPlatformPermission(response.locals.auth.role as AppRole, permission)) {
      response.status(403).json({ error: "You do not have access to this resource" });
      return;
    }
    next();
  };
}
