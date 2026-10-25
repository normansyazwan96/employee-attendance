import type { NextFunction, Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  sessionFindUnique: vi.fn(),
}));

vi.mock("../src/services/prisma.js", () => ({
  isD1Database: () => false,
  prisma: {
    user: { findUnique: mocks.userFindUnique },
    authSession: { findUnique: mocks.sessionFindUnique },
  },
}));

import { requireCurrentSession } from "../src/middleware/auth.js";

function responseFor(role = "ADMIN") {
  const response = {
    locals: { auth: { sub: "user-1", username: "administrator", role, passwordVersion: 2, sid: "session-1" } },
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe("current session authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue({
      isActive: true,
      passwordVersion: 2,
      mustChangePassword: false,
      role: "ADMIN",
      clientId: "client-1",
      memberships: [{ clientId: "client-1", role: "ADMIN" }],
    });
    mocks.sessionFindUnique.mockResolvedValue({ userId: "user-1", revokedAt: null, expiresAt: new Date(Date.now() + 60_000) });
  });

  it("allows a session whose token, account role, and active membership agree", async () => {
    const response = responseFor();
    const next = vi.fn();
    await requireCurrentSession({} as Request, response as unknown as Response, next as NextFunction);
    expect(next).toHaveBeenCalledOnce();
  });

  it("rejects a token containing a stale elevated role", async () => {
    mocks.userFindUnique.mockResolvedValue({
      isActive: true,
      passwordVersion: 2,
      mustChangePassword: false,
      role: "EMPLOYEE",
      clientId: "client-1",
      memberships: [{ clientId: "client-1", role: "EMPLOYEE" }],
    });
    const response = responseFor("ADMIN");
    const next = vi.fn();
    await requireCurrentSession({} as Request, response as unknown as Response, next as NextFunction);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an account after its organization membership is disabled", async () => {
    mocks.userFindUnique.mockResolvedValue({ isActive: true, passwordVersion: 2, mustChangePassword: false, role: "ADMIN", clientId: "client-1", memberships: [] });
    const response = responseFor();
    const next = vi.fn();
    await requireCurrentSession({} as Request, response as unknown as Response, next as NextFunction);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
