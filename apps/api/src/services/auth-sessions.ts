import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export const accessTokenLifetimeSeconds = 15 * 60;
export const refreshTokenLifetimeSeconds = 30 * 24 * 60 * 60;

export const sessionUserInclude = {
  employee: true,
  mfaCredential: { select: { enabled: true } },
  memberships: {
    where: { status: "ACTIVE" },
    select: { id: true, clientId: true, role: true, status: true },
  },
} satisfies Prisma.UserInclude;

export type SessionUser = Prisma.UserGetPayload<{ include: typeof sessionUserInclude }>;

export type SessionMetadata = {
  ipAddress?: string;
  userAgent?: string;
};

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newRefreshToken(): string {
  return randomBytes(48).toString("base64url");
}

export async function createAuthSession(userId: string, metadata: SessionMetadata): Promise<{ id: string; refreshToken: string }> {
  const refreshToken = newRefreshToken();
  const session = await prisma.authSession.create({
    data: {
      userId,
      refreshTokenHash: hashRefreshToken(refreshToken),
      familyId: randomUUID(),
      expiresAt: new Date(Date.now() + refreshTokenLifetimeSeconds * 1_000),
      ...metadata,
    },
    select: { id: true },
  });
  return { id: session.id, refreshToken };
}

export async function rotateAuthSession(refreshToken: string, metadata: SessionMetadata): Promise<{ id: string; refreshToken: string; user: SessionUser } | null> {
  const current = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hashRefreshToken(refreshToken) },
    include: { user: { include: sessionUserInclude } },
  });
  if (!current) return null;

  if (current.revokedAt) {
    await prisma.authSession.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    return null;
  }
  if (current.expiresAt <= new Date() || !current.user.isActive) {
    await prisma.authSession.updateMany({ where: { id: current.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return null;
  }

  const nextRefreshToken = newRefreshToken();
  const rotated = await prisma.$transaction(async (transaction) => {
    const revoked = await transaction.authSession.updateMany({
      where: { id: current.id, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
    if (revoked.count !== 1) return null;

    return transaction.authSession.create({
      data: {
        userId: current.userId,
        refreshTokenHash: hashRefreshToken(nextRefreshToken),
        familyId: current.familyId,
        rotatedFromId: current.id,
        expiresAt: new Date(Date.now() + refreshTokenLifetimeSeconds * 1_000),
        ...metadata,
      },
      select: { id: true },
    });
  });

  return rotated ? { id: rotated.id, refreshToken: nextRefreshToken, user: current.user } : null;
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  await prisma.authSession.updateMany({
    where: { refreshTokenHash: hashRefreshToken(refreshToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
