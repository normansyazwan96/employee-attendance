import { createHash, randomBytes, randomUUID } from "node:crypto";
import { MembershipRole, Prisma, Role } from "@prisma/client";
import { isD1Database, prisma } from "./prisma.js";

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

type SessionAccessUser = {
  role: Role;
  isGlobalAdmin?: boolean;
  clientId: string | null;
  memberships: Array<{ clientId: string; role: MembershipRole }>;
};

export function hasActiveSessionAccess(user: SessionAccessUser): boolean {
  if (user.role === Role.DEV_ADMIN || user.isGlobalAdmin) return true;
  if (!user.clientId) return false;
  const membershipRole = user.role === Role.ADMIN
    ? MembershipRole.ADMIN
    : user.role === Role.MANAGER
      ? MembershipRole.MANAGER
      : MembershipRole.EMPLOYEE;
  return user.memberships.some((membership) => membership.clientId === user.clientId && membership.role === membershipRole);
}

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
  if (current.expiresAt <= new Date() || !current.user.isActive || !hasActiveSessionAccess(current.user)) {
    await prisma.authSession.updateMany({ where: { familyId: current.familyId, revokedAt: null }, data: { revokedAt: new Date() } });
    return null;
  }

  const nextRefreshToken = newRefreshToken();
  if (isD1Database()) {
    // D1 supports batched transactions but not Prisma interactive transactions.
    // Worker writes are serialized by DatabaseWriteCoordinator, so the row cannot
    // be claimed by another refresh request between the read and this batch.
    const [revoked, rotated] = await prisma.$transaction([
      prisma.authSession.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), lastUsedAt: new Date() },
      }),
      prisma.authSession.create({
        data: {
          userId: current.userId,
          refreshTokenHash: hashRefreshToken(nextRefreshToken),
          familyId: current.familyId,
          rotatedFromId: current.id,
          expiresAt: new Date(Date.now() + refreshTokenLifetimeSeconds * 1_000),
          ...metadata,
        },
        select: { id: true },
      }),
    ]);
    if (revoked.count !== 1) {
      await prisma.authSession.updateMany({ where: { id: rotated.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return null;
    }
    return { id: rotated.id, refreshToken: nextRefreshToken, user: current.user };
  }
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

export async function revokeRefreshToken(refreshToken: string): Promise<{ id: string; userId: string; clientId: string | null } | null> {
  const session = await prisma.authSession.findUnique({
    where: { refreshTokenHash: hashRefreshToken(refreshToken) },
    select: { id: true, userId: true, user: { select: { clientId: true } } },
  });
  if (!session) return null;
  const revoked = await prisma.authSession.updateMany({
    where: { id: session.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return revoked.count === 1 ? { id: session.id, userId: session.userId, clientId: session.user.clientId } : null;
}
