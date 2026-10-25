import { Prisma, Role } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { recordAudit } from "../services/audit.js";
import { getAdminContext } from "../services/admin-scope.js";
import { malaysiaStates } from "../services/malaysia-holidays.js";

const worksiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  stateCode: z.string().regex(/^\d{2}$/).refine((value) => Boolean(malaysiaStates()[value])),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(25).max(10_000),
  isActive: z.boolean(),
});

type AdminContext = NonNullable<Awaited<ReturnType<typeof getAdminContext>>>;

function visibleWorksites(context: AdminContext): Prisma.WorksiteWhereInput {
  return { clientId: context.clientId };
}

function manageableWorksite(context: AdminContext, id: string): Prisma.WorksiteWhereInput {
  return { id, clientId: context.clientId };
}

function withPermissions<T extends { clientId: string; ownerAdminId: string | null }>(context: AdminContext, worksite: T): T & { canManage: boolean } {
  return { ...worksite, canManage: context.auth.role === Role.DEV_ADMIN || worksite.clientId === context.clientId };
}

function parseWorksite(response: Response, body: unknown): z.infer<typeof worksiteSchema> | null {
  const parsed = worksiteSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  response.status(400).json({ error: "Enter a name, Malaysian state, valid coordinates, and a radius between 25 and 10,000 meters" });
  return null;
}

function handleDuplicateName(error: unknown, response: Response): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  response.status(409).json({ error: "A worksite with that name already exists in this scope" });
  return true;
}

export async function getAdminWorksites(_request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context?.clientId) { response.status(400).json({ error: "Select an organization before viewing worksites" }); return; }
  const worksites = await prisma.worksite.findMany({ where: visibleWorksites(context), orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  response.json({ worksites: worksites.map((worksite) => withPermissions(context, worksite)) });
}

export async function createAdminWorksite(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context?.clientId) { response.status(400).json({ error: "A client account is required to create a worksite" }); return; }
  const data = parseWorksite(response, request.body);
  if (!data) return;
  try {
    const worksite = await prisma.worksite.create({ data: { ...data, clientId: context.clientId, ownerAdminId: context.auth.role === Role.DEV_ADMIN ? null : context.auth.sub } });
    await recordAudit({ actorUserId: response.locals.auth.sub, clientId: worksite.clientId, action: "CREATE", entityType: "Worksite", entityId: worksite.id, details: data });
    response.status(201).json({ worksite: withPermissions(context, worksite) });
  } catch (error) {
    if (!handleDuplicateName(error, response)) throw error;
  }
}

export async function updateAdminWorksite(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context?.clientId) { response.status(400).json({ error: "Select an organization before updating a worksite" }); return; }
  const data = parseWorksite(response, request.body);
  if (!data) return;
  const id = String(request.params.id);
  try {
    const worksite = await prisma.worksite.updateMany({ where: manageableWorksite(context, id), data });
    if (worksite.count === 0) { response.status(404).json({ error: "Worksite not found" }); return; }
    const updated = await prisma.worksite.findUnique({ where: { id } });
    await recordAudit({ actorUserId: response.locals.auth.sub, clientId: updated?.clientId, action: "UPDATE", entityType: "Worksite", entityId: id, details: data });
    response.json({ worksite: updated && withPermissions(context, updated) });
  } catch (error) {
    if (!handleDuplicateName(error, response)) throw error;
  }
}

export async function deleteAdminWorksite(request: Request, response: Response): Promise<void> {
  const context = await getAdminContext(response);
  if (!context?.clientId) { response.status(400).json({ error: "Select an organization before deleting a worksite" }); return; }
  const id = String(request.params.id);
  const where = manageableWorksite(context, id);
  const existing = await prisma.worksite.findFirst({ where, select: { clientId: true } });
  const deleted = await prisma.worksite.deleteMany({ where });
  if (deleted.count === 0) { response.status(404).json({ error: "Worksite not found" }); return; }
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: existing?.clientId, action: "DELETE", entityType: "Worksite", entityId: id });
  response.status(204).send();
}
