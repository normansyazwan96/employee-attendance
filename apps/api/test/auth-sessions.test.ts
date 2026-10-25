import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("../src/services/prisma.js", () => ({
  isD1Database: () => true,
  prisma: {
    authSession: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      create: mocks.create,
    },
    $transaction: mocks.transaction,
  },
}));

import { hasActiveSessionAccess, hashRefreshToken, rotateAuthSession } from "../src/services/auth-sessions.js";

describe("D1 refresh-session rotation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.create.mockResolvedValue({ id: "next-session" });
    mocks.transaction.mockImplementation(async (operations: Array<Promise<unknown>>) => Promise.all(operations));
  });

  it("rotates the refresh token with a supported batched transaction", async () => {
    const user = { id: "dev-user", isActive: true, passwordVersion: 0, role: "DEV_ADMIN" as const, clientId: null, memberships: [], employee: null, mfaCredential: null };
    mocks.findUnique.mockResolvedValue({
      id: "current-session",
      userId: user.id,
      familyId: "family-1",
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
      user,
    });

    const result = await rotateAuthSession("current-refresh-token", { ipAddress: "127.0.0.1" });

    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { refreshTokenHash: hashRefreshToken("current-refresh-token") } }));
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "current-session", revokedAt: null } }));
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ userId: user.id, familyId: "family-1", rotatedFromId: "current-session" }) }));
    expect(result).toMatchObject({ id: "next-session", user });
    expect(result?.refreshToken).not.toBe("current-refresh-token");
  });

  it("rejects refresh when the account no longer has an active role membership", async () => {
    const user = { id: "admin-user", isActive: true, passwordVersion: 0, role: "ADMIN" as const, clientId: "client-1", memberships: [], employee: null, mfaCredential: null };
    mocks.findUnique.mockResolvedValue({ id: "current-session", userId: user.id, familyId: "family-1", revokedAt: null, expiresAt: new Date(Date.now() + 60_000), user });

    await expect(rotateAuthSession("current-refresh-token", {})).resolves.toBeNull();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { familyId: "family-1", revokedAt: null } }));
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("matches the current account role to its organization membership", () => {
    expect(hasActiveSessionAccess({ role: "ADMIN", clientId: "client-1", memberships: [{ clientId: "client-1", role: "ADMIN" }] })).toBe(true);
    expect(hasActiveSessionAccess({ role: "ADMIN", clientId: "client-1", memberships: [{ clientId: "client-2", role: "ADMIN" }] })).toBe(false);
    expect(hasActiveSessionAccess({ role: "MANAGER", clientId: "client-1", memberships: [{ clientId: "client-1", role: "EMPLOYEE" }] })).toBe(false);
    expect(hasActiveSessionAccess({ role: "DEV_ADMIN", clientId: null, memberships: [] })).toBe(true);
    expect(hasActiveSessionAccess({ role: "ADMIN", isGlobalAdmin: true, clientId: null, memberships: [] })).toBe(true);
  });
});
