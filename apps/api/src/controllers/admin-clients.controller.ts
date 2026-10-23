import { Prisma, Role } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { getAdminContext } from "../services/admin-scope.js";
import { recordAudit } from "../services/audit.js";

const organizationSchema = z.object({ name: z.string().trim().min(2).max(120), stateCode: z.string().regex(/^\d{2}$/).nullable().optional() });

export async function getAdminClients(_request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as { sub: string; role: Role };
  if (auth.role === Role.DEV_ADMIN) { response.json({ clients: await prisma.client.findMany({ orderBy: { name: "asc" } }) }); return; }
  const context = await getAdminContext(response);
  if (!context?.clientId) { response.status(401).json({ error: "An active organization membership is required" }); return; }
  response.json({ clients: await prisma.client.findMany({ where: { id: context.clientId }, orderBy: { name: "asc" } }) });
}

export async function createAdminClient(request: Request, response: Response): Promise<void> {
  const auth = response.locals.auth as { sub: string; role: Role };
  if (auth.role !== Role.DEV_ADMIN) { response.status(403).json({ error: "Only a dev admin can create organizations" }); return; }
  const parsed = organizationSchema.safeParse(request.body);
  if (!parsed.success) { response.status(400).json({ error: "Enter an organization name and valid Malaysian state code" }); return; }
  const duplicate = await prisma.client.findFirst({ where: { name: { equals: parsed.data.name, mode: "insensitive" } }, select: { id: true } });
  if (duplicate) { response.status(409).json({ error: "An organization with that name already exists" }); return; }
  try {
    const client = await prisma.client.create({ data: { ...parsed.data, workPolicy: { create: {} }, leaveTypes: { create: [{ code: "ANNUAL", name: "Annual Leave", isPaid: true }, { code: "SICK", name: "Sick Leave", isPaid: true }, { code: "UNPAID", name: "Unpaid Leave", isPaid: false }] } } });
    await recordAudit({ actorUserId: auth.sub, clientId: client.id, action: "CREATE", entityType: "Organization", entityId: client.id, details: { name: client.name, stateCode: client.stateCode }, requestId: response.locals.requestId, ipAddress: request.ip });
    response.status(201).json({ client });
  } catch (caught) {
    if (caught instanceof Prisma.PrismaClientKnownRequestError && caught.code === "P2002") { response.status(409).json({ error: "The organization could not be created because a value is already in use" }); return; }
    throw caught;
  }
}
