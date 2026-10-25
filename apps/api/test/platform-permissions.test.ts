import { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { hasPlatformPermission, platformPermissions } from "../src/services/platform-permissions.js";

describe("platform permission matrix", () => {
  it("grants every platform permission only to the owner role", () => {
    expect(platformPermissions.every((permission) => hasPlatformPermission(Role.DEV_ADMIN, permission))).toBe(true);
  });

  it("keeps global administrators read only and outside tenant operations", () => {
    expect(hasPlatformPermission("GLOBAL_ADMIN", "PLATFORM_ORGANIZATIONS_READ")).toBe(true);
    expect(hasPlatformPermission("GLOBAL_ADMIN", "PLATFORM_ADMINS_READ")).toBe(true);
    expect(hasPlatformPermission("GLOBAL_ADMIN", "PLATFORM_ORGANIZATIONS_WRITE")).toBe(false);
    expect(hasPlatformPermission("GLOBAL_ADMIN", "PLATFORM_ADMINS_WRITE")).toBe(false);
    expect(hasPlatformPermission("GLOBAL_ADMIN", "PLATFORM_AUDIT_READ")).toBe(false);
    expect(hasPlatformPermission("GLOBAL_ADMIN", "PLATFORM_SYSTEM_READ")).toBe(false);
    expect(hasPlatformPermission("GLOBAL_ADMIN", "TENANT_OPERATIONS")).toBe(false);
  });

  it("limits tenant roles to their organization workflows", () => {
    expect(hasPlatformPermission(Role.ADMIN, "TENANT_OPERATIONS")).toBe(true);
    expect(hasPlatformPermission(Role.MANAGER, "TENANT_OPERATIONS")).toBe(true);
    expect(hasPlatformPermission(Role.EMPLOYEE, "TENANT_OPERATIONS")).toBe(false);
    expect(hasPlatformPermission(Role.ADMIN, "PLATFORM_AUDIT_READ")).toBe(false);
    expect(hasPlatformPermission(Role.MANAGER, "PLATFORM_ADMINS_READ")).toBe(false);
  });
});
