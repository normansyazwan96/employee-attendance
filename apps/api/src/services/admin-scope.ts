import { MembershipRole, MembershipStatus, Prisma, Role } from "@prisma/client";
import type { Response } from "express";
import { prisma } from "./prisma.js";

export type AdminAuth = { sub: string; role: Role };
export type AdminContext = { auth: AdminAuth; clientId: string | undefined; membershipId?: string; membershipRole?: MembershipRole; employeeUserWhere: Prisma.UserWhereInput };

export async function getAdminContext(response: Response): Promise<AdminContext | null> {
  const auth = response.locals.auth as AdminAuth;
  if (auth.role === Role.DEV_ADMIN) {
    const requested = response.locals.requestedOrganizationId as string | undefined;
    if (!requested) return { auth, clientId: undefined, employeeUserWhere: { role: Role.EMPLOYEE } };
    const client = await prisma.client.findUnique({ where: { id: requested }, select: { id: true } });
    if (!client) return null;
    return { auth, clientId: client.id, employeeUserWhere: { role: Role.EMPLOYEE, clientId: client.id } };
  }
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: auth.sub, status: MembershipStatus.ACTIVE, role: { in: [MembershipRole.ADMIN, MembershipRole.MANAGER] } },
    orderBy: { createdAt: "asc" },
    select: { id: true, clientId: true, role: true },
  });
  if (!membership) return null;
  const ownership = membership.role === MembershipRole.ADMIN
    ? { createdByUserId: auth.sub }
    : { memberships: { some: { clientId: membership.clientId, status: MembershipStatus.ACTIVE, managerMembershipId: membership.id } } };
  return {
    auth,
    clientId: membership.clientId,
    membershipId: membership.id,
    membershipRole: membership.role,
    employeeUserWhere: { role: Role.EMPLOYEE, clientId: membership.clientId, ...ownership },
  };
}
