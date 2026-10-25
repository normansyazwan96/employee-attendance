import {
  EpfContributionCategory,
  MembershipRole,
  PayType,
  PayrollCalculationBasis,
  PayrollComponentType,
  PayrollFrequency,
  PayrollJurisdiction,
  Prisma,
  Role,
  SocsoContributionCategory,
} from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { getAdminContext, type AdminContext } from "../services/admin-scope.js";
import { recordAudit } from "../services/audit.js";
import { acquireDatabaseLock, prisma } from "../services/prisma.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const positiveMoney = z.number().int().min(1).max(2_000_000_000);
const settingsSchema = z.object({
  jurisdiction: z.nativeEnum(PayrollJurisdiction),
  payFrequency: z.nativeEnum(PayrollFrequency),
  normalDailyMinutes: z.number().int().min(60).max(1_440),
  normalWeeklyMinutes: z.number().int().min(60).max(10_080),
  salaryDivisor: z.number().int().min(1).max(31),
  statutoryContributionsEnabled: z.boolean().optional(),
});
const payProfileSchema = z.object({
  employeeId: z.string().min(1),
  payType: z.nativeEnum(PayType),
  baseRateSen: positiveMoney,
  normalDailyMinutes: z.number().int().min(60).max(1_440),
  normalWeeklyMinutes: z.number().int().min(60).max(10_080),
  overtimeEligible: z.boolean(),
  effectiveFrom: isoDate,
});
const componentSchema = z.object({
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  name: z.string().trim().min(1).max(120),
  type: z.nativeEnum(PayrollComponentType),
  calculationBasis: z.nativeEnum(PayrollCalculationBasis),
  defaultAmountSen: z.number().int().min(0).max(2_000_000_000).default(0),
  defaultPercentageBps: z.number().int().min(1).max(10_000).nullable().optional(),
  epfEligible: z.boolean().default(true),
  socsoEligible: z.boolean().default(true),
  eisEligible: z.boolean().default(true),
});
const assignmentSchema = z.object({
  employeeId: z.string().min(1),
  payrollComponentId: z.string().min(1),
  amountSen: z.number().int().min(0).max(2_000_000_000).default(0),
  percentageBasisPoints: z.number().int().min(1).max(10_000).nullable().optional(),
  totalAmountSen: positiveMoney.nullable().optional(),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
  consentReference: z.string().trim().min(1).max(200).nullable().optional(),
  notes: z.string().trim().max(500).nullable().optional(),
});
const permissionSchema = z.object({ canManagePayroll: z.boolean() });
const statutoryProfileSchema = z.object({
  employeeId: z.string().min(1),
  epfCategory: z.nativeEnum(EpfContributionCategory),
  socsoCategory: z.nativeEnum(SocsoContributionCategory),
  eisEligible: z.boolean(),
  effectiveFrom: isoDate,
});

const rulePacks: Record<PayrollJurisdiction, string> = {
  PENINSULAR_LABUAN: "MY-PEN-2023-01",
  SABAH: "MY-SABAH-PENDING-REVIEW",
  SARAWAK: "MY-SARAWAK-PENDING-REVIEW",
};

function payrollError(response: Response, status: number, code: string, message: string, details?: unknown): void {
  response.status(status).json({ error: { code, message, ...(details === undefined ? {} : { details }) }, requestId: response.locals.requestId });
}
async function payrollScope(request: Request, response: Response): Promise<(AdminContext & { clientId: string }) | null> {
  const context = await getAdminContext(response);
  if (!context) {
    payrollError(response, 403, "ORGANIZATION_ACCESS_REQUIRED", "An active administrator membership is required");
    return null;
  }
  if (!context.clientId) {
    payrollError(response, 400, "ORGANIZATION_REQUIRED", "Select an organization for payroll");
    return null;
  }
  if (!context.canManagePayroll) {
    payrollError(response, 403, "PAYROLL_ACCESS_REQUIRED", "Payroll access has not been granted to this administrator");
    return null;
  }
  return { ...context, clientId: context.clientId };
}

function previousIsoDate(value: string): string {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() - 1);
  return parsed.toISOString().slice(0, 10);
}

async function scopedEmployee(context: AdminContext & { clientId: string }, employeeId: string) {
  return prisma.employee.findFirst({
    where: { id: employeeId, user: context.employeeUserWhere },
    select: { id: true, firstName: true, lastName: true, employeeNumber: true },
  });
}

export async function getPayrollSettingsV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const settings = await prisma.payrollSettings.upsert({
    where: { clientId: scope.clientId },
    update: {},
    create: { clientId: scope.clientId },
  });
  response.json({ data: settings });
}

export async function updatePayrollSettingsV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const parsed = settingsSchema.safeParse(request.body);
  if (!parsed.success || parsed.data.normalWeeklyMinutes < parsed.data.normalDailyMinutes) {
    payrollError(response, 400, "INVALID_PAYROLL_SETTINGS", "Enter valid payroll hours and settings");
    return;
  }
  const settings = await prisma.payrollSettings.upsert({
    where: { clientId: scope.clientId },
    update: { ...parsed.data, currency: "MYR", rulePackVersion: rulePacks[parsed.data.jurisdiction] },
    create: { clientId: scope.clientId, ...parsed.data, currency: "MYR", rulePackVersion: rulePacks[parsed.data.jurisdiction] },
  });
  await recordAudit({
    actorUserId: scope.auth.sub,
    clientId: scope.clientId,
    action: "UPDATE",
    entityType: "PayrollSettings",
    entityId: settings.id,
    details: { ...parsed.data, rulePackVersion: settings.rulePackVersion },
    requestId: response.locals.requestId,
    ipAddress: request.ip,
  });
  response.json({ data: settings });
}

export async function listPayProfilesV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const data = await prisma.payProfile.findMany({
    where: { employee: { user: scope.employeeUserWhere } },
    include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, user: { select: { username: true } } } } },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });
  response.setHeader("cache-control", "private, no-store");
  response.json({ data });
}

export async function createPayProfileV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const parsed = payProfileSchema.safeParse(request.body);
  if (!parsed.success || parsed.data.normalWeeklyMinutes < parsed.data.normalDailyMinutes) {
    payrollError(response, 400, "INVALID_PAY_PROFILE", "Enter a valid employee rate, hours, and effective date");
    return;
  }
  const employee = await scopedEmployee(scope, parsed.data.employeeId);
  if (!employee) { payrollError(response, 404, "EMPLOYEE_NOT_FOUND", "Employee not found"); return; }

  try {
    const profile = await prisma.$transaction(async (transaction) => {
      await acquireDatabaseLock(transaction, parsed.data.employeeId);
      const latest = await transaction.payProfile.findFirst({ where: { employeeId: employee.id }, orderBy: { effectiveFrom: "desc" } });
      if (latest && latest.effectiveFrom >= parsed.data.effectiveFrom) throw new Error("PAY_PROFILE_DATE_CONFLICT");
      if (latest && (!latest.effectiveTo || latest.effectiveTo >= parsed.data.effectiveFrom)) {
        await transaction.payProfile.update({ where: { id: latest.id }, data: { effectiveTo: previousIsoDate(parsed.data.effectiveFrom) } });
      }
      return transaction.payProfile.create({ data: { ...parsed.data, createdByUserId: scope.auth.sub } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await recordAudit({
      actorUserId: scope.auth.sub,
      clientId: scope.clientId,
      action: "CREATE",
      entityType: "PayProfile",
      entityId: profile.id,
      details: { employeeId: employee.id, payType: profile.payType, effectiveFrom: profile.effectiveFrom, overtimeEligible: profile.overtimeEligible },
      requestId: response.locals.requestId,
      ipAddress: request.ip,
    });
    response.status(201).json({ data: profile });
  } catch (caught) {
    if (caught instanceof Error && caught.message === "PAY_PROFILE_DATE_CONFLICT") {
      payrollError(response, 409, "PAY_PROFILE_DATE_CONFLICT", "The effective date must be later than the employee's latest pay profile");
      return;
    }
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
      payrollError(response, 409, "PAY_PROFILE_EXISTS", "A pay profile already starts on this date");
      return;
    }
    throw caught;
  }
}

export async function listEmployeeStatutoryProfilesV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const data = await prisma.employeeStatutoryProfile.findMany({
    where: { employee: { user: scope.employeeUserWhere } },
    include: { employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, user: { select: { username: true } } } } },
    orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
  });
  response.setHeader("cache-control", "private, no-store");
  response.json({ data });
}

export async function createEmployeeStatutoryProfileV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const parsed = statutoryProfileSchema.safeParse(request.body);
  if (!parsed.success) { payrollError(response, 400, "INVALID_STATUTORY_PROFILE", "Choose valid EPF, SOCSO, and EIS settings"); return; }
  const employee = await scopedEmployee(scope, parsed.data.employeeId);
  if (!employee) { payrollError(response, 404, "EMPLOYEE_NOT_FOUND", "Employee not found"); return; }

  try {
    const profile = await prisma.$transaction(async (transaction) => {
      await acquireDatabaseLock(transaction, parsed.data.employeeId);
      const latest = await transaction.employeeStatutoryProfile.findFirst({ where: { employeeId: employee.id }, orderBy: { effectiveFrom: "desc" } });
      if (latest && latest.effectiveFrom >= parsed.data.effectiveFrom) throw new Error("STATUTORY_PROFILE_DATE_CONFLICT");
      if (latest && (!latest.effectiveTo || latest.effectiveTo >= parsed.data.effectiveFrom)) {
        await transaction.employeeStatutoryProfile.update({ where: { id: latest.id }, data: { effectiveTo: previousIsoDate(parsed.data.effectiveFrom) } });
      }
      return transaction.employeeStatutoryProfile.create({ data: { ...parsed.data, createdByUserId: scope.auth.sub } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await recordAudit({
      actorUserId: scope.auth.sub,
      clientId: scope.clientId,
      action: "CREATE",
      entityType: "EmployeeStatutoryProfile",
      entityId: profile.id,
      details: { employeeId: employee.id, epfCategory: profile.epfCategory, socsoCategory: profile.socsoCategory, eisEligible: profile.eisEligible, effectiveFrom: profile.effectiveFrom },
      requestId: response.locals.requestId,
      ipAddress: request.ip,
    });
    response.status(201).json({ data: profile });
  } catch (caught) {
    if (caught instanceof Error && caught.message === "STATUTORY_PROFILE_DATE_CONFLICT") {
      payrollError(response, 409, "STATUTORY_PROFILE_DATE_CONFLICT", "The effective date must be later than the employee's latest statutory profile");
      return;
    }
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
      payrollError(response, 409, "STATUTORY_PROFILE_EXISTS", "A statutory profile already starts on this date");
      return;
    }
    throw caught;
  }
}

export async function listPayrollComponentsV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const data = await prisma.payrollComponent.findMany({ where: { clientId: scope.clientId }, orderBy: [{ isActive: "desc" }, { type: "asc" }, { name: "asc" }] });
  response.json({ data });
}

export async function createPayrollComponentV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const parsed = componentSchema.safeParse(request.body);
  if (!parsed.success) { payrollError(response, 400, "INVALID_PAYROLL_COMPONENT", "Enter a valid payroll item"); return; }
  const input = parsed.data;
  if (input.type === PayrollComponentType.ADVANCE_REPAYMENT && input.calculationBasis !== PayrollCalculationBasis.FIXED_AMOUNT) {
    payrollError(response, 400, "INVALID_ADVANCE_COMPONENT", "Advance repayments must use a fixed amount");
    return;
  }
  if (input.calculationBasis === PayrollCalculationBasis.PERCENTAGE ? !input.defaultPercentageBps : input.defaultAmountSen < 1) {
    payrollError(response, 400, "INVALID_COMPONENT_VALUE", "Enter a default amount or percentage");
    return;
  }
  try {
    const component = await prisma.payrollComponent.create({ data: { clientId: scope.clientId, ...input } });
    await recordAudit({
      actorUserId: scope.auth.sub,
      clientId: scope.clientId,
      action: "CREATE",
      entityType: "PayrollComponent",
      entityId: component.id,
      details: { code: component.code, name: component.name, type: component.type, calculationBasis: component.calculationBasis },
      requestId: response.locals.requestId,
      ipAddress: request.ip,
    });
    response.status(201).json({ data: component });
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
      payrollError(response, 409, "PAYROLL_COMPONENT_EXISTS", "A payroll item with this code already exists");
      return;
    }
    throw caught;
  }
}

export async function listEmployeePayComponentsV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const data = await prisma.employeePayComponent.findMany({
    where: { clientId: scope.clientId, employee: { user: scope.employeeUserWhere } },
    include: {
      payrollComponent: true,
      employee: { select: { id: true, firstName: true, lastName: true, employeeNumber: true, user: { select: { username: true } } } },
    },
    orderBy: [{ isActive: "desc" }, { effectiveFrom: "desc" }, { id: "desc" }],
  });
  response.setHeader("cache-control", "private, no-store");
  response.json({ data });
}

export async function createEmployeePayComponentV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  const parsed = assignmentSchema.safeParse(request.body);
  if (!parsed.success || (parsed.data.effectiveTo && parsed.data.effectiveTo < parsed.data.effectiveFrom)) {
    payrollError(response, 400, "INVALID_PAY_COMPONENT_ASSIGNMENT", "Enter a valid employee payroll item and effective date");
    return;
  }
  const [employee, component] = await Promise.all([
    scopedEmployee(scope, parsed.data.employeeId),
    prisma.payrollComponent.findFirst({ where: { id: parsed.data.payrollComponentId, clientId: scope.clientId, isActive: true } }),
  ]);
  if (!employee) { payrollError(response, 404, "EMPLOYEE_NOT_FOUND", "Employee not found"); return; }
  if (!component) { payrollError(response, 404, "PAYROLL_COMPONENT_NOT_FOUND", "Payroll item not found"); return; }

  const isPercentage = component.calculationBasis === PayrollCalculationBasis.PERCENTAGE;
  const requiresConsent = component.type !== PayrollComponentType.EARNING;
  if (isPercentage ? !parsed.data.percentageBasisPoints : parsed.data.amountSen < 1) {
    payrollError(response, 400, "INVALID_ASSIGNMENT_VALUE", "Enter an amount or percentage for this payroll item");
    return;
  }
  if (requiresConsent && !parsed.data.consentReference) {
    payrollError(response, 400, "CONSENT_REFERENCE_REQUIRED", "Deductions and advance repayments require an authorization reference");
    return;
  }
  if (component.type === PayrollComponentType.ADVANCE_REPAYMENT && (!parsed.data.totalAmountSen || parsed.data.amountSen > parsed.data.totalAmountSen)) {
    payrollError(response, 400, "INVALID_ADVANCE_BALANCE", "Enter an advance total that is at least the scheduled deduction");
    return;
  }

  try {
    const assignment = await prisma.employeePayComponent.create({
      data: {
        clientId: scope.clientId,
        ...parsed.data,
        outstandingAmountSen: component.type === PayrollComponentType.ADVANCE_REPAYMENT ? parsed.data.totalAmountSen : null,
        createdByUserId: scope.auth.sub,
      },
      include: { payrollComponent: true },
    });
    await recordAudit({
      actorUserId: scope.auth.sub,
      clientId: scope.clientId,
      action: "CREATE",
      entityType: component.type === PayrollComponentType.ADVANCE_REPAYMENT ? "SalaryAdvance" : "EmployeePayComponent",
      entityId: assignment.id,
      details: { employeeId: employee.id, payrollComponentId: component.id, type: component.type, effectiveFrom: assignment.effectiveFrom, consentReference: assignment.consentReference },
      requestId: response.locals.requestId,
      ipAddress: request.ip,
    });
    response.status(201).json({ data: assignment });
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") {
      payrollError(response, 409, "PAY_COMPONENT_ASSIGNMENT_EXISTS", "This payroll item already starts on that date for the employee");
      return;
    }
    throw caught;
  }
}

export async function listPayrollPermissionsV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  if (scope.auth.role !== Role.DEV_ADMIN) { payrollError(response, 403, "DEV_ADMIN_REQUIRED", "Only a dev admin can manage payroll permissions"); return; }
  const data = await prisma.organizationMembership.findMany({
    where: { clientId: scope.clientId, role: MembershipRole.ADMIN },
    select: { id: true, canManagePayroll: true, status: true, user: { select: { id: true, username: true, displayName: true, isActive: true } } },
    orderBy: { createdAt: "asc" },
  });
  response.json({ data });
}

export async function updatePayrollPermissionV2(request: Request, response: Response): Promise<void> {
  const scope = await payrollScope(request, response); if (!scope) return;
  if (scope.auth.role !== Role.DEV_ADMIN) { payrollError(response, 403, "DEV_ADMIN_REQUIRED", "Only a dev admin can manage payroll permissions"); return; }
  const parsed = permissionSchema.safeParse(request.body);
  if (!parsed.success) { payrollError(response, 400, "INVALID_PAYROLL_PERMISSION", "Choose whether payroll access is allowed"); return; }
  const membership = await prisma.organizationMembership.findFirst({ where: { id: String(request.params.id), clientId: scope.clientId, role: MembershipRole.ADMIN } });
  if (!membership) { payrollError(response, 404, "ADMIN_MEMBERSHIP_NOT_FOUND", "Administrator membership not found"); return; }
  const updated = await prisma.organizationMembership.update({ where: { id: membership.id }, data: parsed.data });
  await recordAudit({
    actorUserId: scope.auth.sub,
    clientId: scope.clientId,
    action: "UPDATE_PAYROLL_PERMISSION",
    entityType: "OrganizationMembership",
    entityId: updated.id,
    details: parsed.data,
    requestId: response.locals.requestId,
    ipAddress: request.ip,
  });
  response.json({ data: updated });
}
