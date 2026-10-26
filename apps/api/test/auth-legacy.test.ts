import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  update: vi.fn(),
  verifyPassword: vi.fn(),
  createAuthSession: vi.fn(),
  authSessionFindUnique: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("../src/services/prisma.js", () => ({
  prisma: {
    user: { findUnique: mocks.findUnique, update: mocks.update },
    authSession: { findUnique: mocks.authSessionFindUnique },
  },
}));

vi.mock("../src/utils/password.js", () => ({ verifyPassword: mocks.verifyPassword }));
vi.mock("../src/services/d1-shadow.js", () => ({ compareAuthIdentityShadow: vi.fn() }));
vi.mock("../src/services/audit.js", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("../src/services/auth-sessions.js", () => ({
  accessTokenLifetimeSeconds: 900,
  refreshTokenLifetimeSeconds: 2_592_000,
  sessionUserInclude: {},
  createAuthSession: mocks.createAuthSession,
  revokeRefreshToken: vi.fn(),
  rotateAuthSession: vi.fn(),
  hasActiveSessionAccess: (user: { role: string; clientId: string | null; memberships: Array<{ clientId: string; role: string }> }) => user.role === "DEV_ADMIN" || user.memberships.some((membership) => membership.clientId === user.clientId && membership.role === user.role),
}));

import { loginV1 } from "../src/controllers/auth-v2.controller.js";
import { requireAuth, requireCurrentSession } from "../src/middleware/auth.js";
import { createAccessToken, verifyAccessToken } from "../src/utils/token.js";

const user = {
  id: "user-1",
  username: "legacy-user",
  passwordHash: "hash",
  passwordVersion: 2,
  role: "EMPLOYEE",
  platformRole: null,
  clientId: "client-1",
  displayName: "Legacy User",
  isActive: true,
  mustChangePassword: false,
  lockedUntil: null,
  employee: null,
  memberships: [{ id: "membership-1", clientId: "client-1", role: "EMPLOYEE", status: "ACTIVE" }],
  mfaCredential: null,
};

function app() {
  const instance = express();
  instance.use(express.json());
  instance.post("/login", loginV1);
  return instance;
}

function protectedApp() {
  const instance = express();
  instance.get("/protected", requireAuth, requireCurrentSession, (_request, response) => response.json({ ok: true }));
  return instance;
}

describe("legacy login security controls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue(user);
    mocks.update.mockResolvedValue({ failedLoginAttempts: 0 });
    mocks.verifyPassword.mockResolvedValue(true);
    mocks.createAuthSession.mockResolvedValue({ id: "session-1", refreshToken: "refresh-token" });
  });

  it("creates a revocable session and returns a session-bound legacy token", async () => {
    const response = await request(app()).post("/login").send({ username: user.username, password: "ValidPassword!123" }).expect(200);
    expect(response.body).toMatchObject({ token: expect.any(String), user: { id: user.id, username: user.username } });
    expect(verifyAccessToken(response.body.token)?.sid).toBe("session-1");
    expect(mocks.createAuthSession).toHaveBeenCalledWith(user.id, expect.any(Object));
  });

  it("requires MFA without issuing a usable session token", async () => {
    mocks.findUnique.mockResolvedValue({ ...user, mfaCredential: { enabled: true } });
    const response = await request(app()).post("/login").send({ username: user.username, password: "ValidPassword!123" }).expect(200);
    expect(response.body).toMatchObject({ mfaRequired: true, challengeToken: expect.any(String) });
    expect(response.body.token).toBeUndefined();
    expect(mocks.createAuthSession).not.toHaveBeenCalled();
  });

  it("honors account lockout before password verification", async () => {
    mocks.findUnique.mockResolvedValue({ ...user, lockedUntil: new Date(Date.now() + 60_000) });
    await request(app()).post("/login").send({ username: user.username, password: "ValidPassword!123" }).expect(423);
    expect(mocks.verifyPassword).not.toHaveBeenCalled();
    expect(mocks.createAuthSession).not.toHaveBeenCalled();
  });

  it("rejects a validly signed token that is not bound to a session", async () => {
    const sessionlessToken = createAccessToken({ sub: user.id, username: user.username, role: "EMPLOYEE", passwordVersion: user.passwordVersion });
    await request(protectedApp()).get("/protected").set("Authorization", `Bearer ${sessionlessToken}`).expect(401);
    expect(mocks.authSessionFindUnique).not.toHaveBeenCalled();
  });
});
