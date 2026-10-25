import { Prisma, Role } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { getAdminContext } from "../services/admin-scope.js";
import { recordAudit } from "../services/audit.js";
import { compareClientListShadow } from "../services/d1-shadow.js";
import type { AppRole } from "../utils/token.js";

const organizationSchema = z.object({ name: z.string().trim().min(2).max(120), stateCode: z.string().regex(/^\d{2}$/).nullable().optional(), isTest: z.boolean().default(false) });
const organizationContextSchema = z.object({ clientId: z.string().min(1).max(128).nullable() });

export async function getAdminClients(_request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as { sub: string; role: AppRole };
  if (auth.role === Role.DEV_ADMIN || auth.role === "GLOBAL_ADMIN") {
    const clients = await prisma.client.findMany({ orderBy: { name: "asc" } });
    await compareClientListShadow(clients);
    response.json({ clients });
    return;
  }
  const context = await getAdminContext(response);
  if (!context?.clientId) { response.status(401).json({ error: "An active organization membership is required" }); return; }
  const clients = await prisma.client.findMany({ where: { id: context.clientId }, orderBy: { name: "asc" } });
  await compareClientListShadow(clients, context.clientId);
  response.json({ clients });
}

export async function createAdminClient(request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as { sub: string; role: Role };
  if (auth.role !== Role.DEV_ADMIN) { response.status(403).json({ error: "Only a dev admin can create organizations" }); return; }
  const parsed = organizationSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter an organization name and valid Malaysian state code" }); return; }
  const existingClients = await prisma.client.findMany({ select: { id: true, name: true } });
  const duplicate = existingClients.find((client) => client.name.toLocaleLowerCase() === parsed.data.name.toLocaleLowerCase());
  if (duplicate) { response.status(409).json({ error: "An organization with that name already exists" }); return; }
  try {
    const client = await prisma.client.create({ data: { ...parsed.data, workPolicy: { create: {} }, leaveTypes: { create: [{ code: "ANNUAL", name: "Annual Leave", isPaid: true }, { code: "SICK", name: "Sick Leave", isPaid: true }, { code: "UNPAID", name: "Unpaid Leave", isPaid: false }] } } });
    await recordAudit({ actorUserId: auth.sub, clientId: client.id, action: "CREATE", entityType: "Organization", entityId: client.id, details: { name: client.name, stateCode: client.stateCode, isTest: client.isTest }, requestId: response.locals.requestId, ipAddress: request.ip });
    response.status(201).json({ client });
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") { response.status(409).json({ error: "The organization could not be created because a value is already in use" }); return; }
    throw caught;
  }
}

export async function selectOrganizationContext(request: Request, response: Response): Promise<void> {
  const parsed = organizationContextSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Choose a valid organization" }); return; }
  const client = parsed.data.clientId
    ? await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true, name: true } })
    : null;
  if (parsed.data.clientId && !client) { response.status(404).json({ error: "Organization not found" }); return; }
  await recordAudit({
    actorUserId: response.locals.auth.sub,
    action: parsed.data.clientId ? "ORGANIZATION_CONTEXT_SELECTED" : "ORGANIZATION_CONTEXT_CLEARED",
    entityType: "Organization",
    entityId: client?.id ?? "none",
    details: { organizationName: client?.name ?? null, platformRole: response.locals.auth.role },
    requestId: response.locals.requestId,
    ipAddress: request.ip,
    userAgent: request.get("user-agent"),
  });
  response.status(204).end();
}
