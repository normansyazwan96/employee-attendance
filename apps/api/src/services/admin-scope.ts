import { MembershipRole, MembershipStatus, Prisma, Role } from "@prisma/client";
import type { Response } from "express";
import { prisma } from "./prisma.js";
import { compareAdminScopeShadow } from "./d1-shadow.js";
import type { AppRole } from "../utils/token.js";

export type AdminAuth = { sub: string; role: AppRole };
export type AdminContext = { auth: AdminAuth; clientId: string | undefined; membershipId?: string; membershipRole?: MembershipRole; canManagePayroll: boolean; employeeUserWhere: Prisma.UserWhereInput };

export async function getAdminContext(response: Response): Promise<AdminContext | null> {
  const auth = response.locals.auth as AdminAuth;
  if (auth.role === Role.DEV_ADMIN) {
    const requested = response.locals.requestedOrganizationId as string | undefined;
    if (!requested) return { auth, clientId: undefined, canManagePayroll: true, employeeUserWhere: { id: "__organization_selection_required__" } };
    const client = await prisma.client.findUnique({ where: { id: requested }, select: { id: true } });
    if (!client) return null;
    return { auth, clientId: client.id, canManagePayroll: true, employeeUserWhere: { role: Role.EMPLOYEE, clientId: client.id } };
  }
  if (auth.role === "GLOBAL_ADMIN") {
    return { auth, clientId: undefined, canManagePayroll: false, employeeUserWhere: { id: "__platform_read_only__" } };
  }
  if (auth.role !== Role.ADMIN && auth.role !== Role.MANAGER) return null;
  const user = await prisma.user.findUnique({
    where: { id: auth.sub },
    select: { role: true, clientId: true },
  });
  if (!user?.clientId || user.role !== auth.role) return null;
  const requiredMembershipRole = auth.role === Role.ADMIN ? MembershipRole.ADMIN : MembershipRole.MANAGER;
  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_clientId: { userId: auth.sub, clientId: user.clientId } },
    select: { id: true, clientId: true, role: true, status: true, managerMembershipId: true, canManagePayroll: true },
  });
  await compareAdminScopeShadow(auth.sub, user.clientId, { user, membership });
  if (!membership || membership.role !== requiredMembershipRole || membership.status !== MembershipStatus.ACTIVE) return null;
  const employeeScope = membership.role === MembershipRole.MANAGER
    ? { memberships: { some: { clientId: membership.clientId, status: MembershipStatus.ACTIVE, managerMembershipId: membership.id } } }
    : {};
  return {
    auth,
    clientId: membership.clientId,
    membershipId: membership.id,
    membershipRole: membership.role,
    canManagePayroll: membership.canManagePayroll,
    employeeUserWhere: { role: Role.EMPLOYEE, clientId: membership.clientId, ...employeeScope },
  };
}
