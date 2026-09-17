import { Role } from "@prisma/client";
import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { recordAudit } from "../services/audit.js";

const worksiteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusMeters: z.number().int().min(25).max(10_000),
  isActive: z.boolean(),
});

async function clientScope(response: Response): Promise<string | null | undefined> {
  const auth = response.locals.auth as { sub: string; role: Role };
  if (auth.role === Role.DEV_ADMIN) return undefined;
  const user = await prisma.user.findUnique({ where: { id: auth.sub }, select: { clientId: true } });
  return user?.clientId ?? null;
}

function parseWorksite(response: Response, body: unknown): z.infer<typeof worksiteSchema> | null {
  const parsed = worksiteSchema.safeParse(body);
  if (parsed.success) return parsed.data;
  response.status(400).json({ error: "Enter a name, valid coordinates, and a radius between 25 and 10,000 meters" });
  return null;
}

export async function getAdminWorksites(_request: Request, response: Response): Promise<void> {
  const clientId = await clientScope(response);
  if (clientId === null) { response.status(401).json({ error: "A client account is required" }); return; }
  const worksites = await prisma.worksite.findMany({ where: clientId ? { clientId } : undefined, orderBy: [{ isActive: "desc" }, { name: "asc" }] });
  response.json({ worksites });
}

export async function createAdminWorksite(request: Request, response: Response): Promise<void> {
  const clientId = await clientScope(response);
  if (!clientId) { response.status(400).json({ error: "A client account is required to create a worksite" }); return; }
  const data = parseWorksite(response, request.body);
  if (!data) return;
  const worksite = await prisma.worksite.create({ data: { ...data, clientId } });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: worksite.clientId, action: "CREATE", entityType: "Worksite", entityId: worksite.id, details: data });
  response.status(201).json({ worksite });
}

export async function updateAdminWorksite(request: Request, response: Response): Promise<void> {
  const clientId = await clientScope(response);
  if (clientId === null) { response.status(401).json({ error: "A client account is required" }); return; }
  const data = parseWorksite(response, request.body);
  if (!data) return;
  const id = String(request.params.id);
  const worksite = await prisma.worksite.updateMany({ where: { id, ...(clientId ? { clientId } : {}) }, data });
  if (worksite.count === 0) { response.status(404).json({ error: "Worksite not found" }); return; }
  const updated = await prisma.worksite.findUnique({ where: { id } });
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: updated?.clientId, action: "UPDATE", entityType: "Worksite", entityId: id, details: data });
  response.json({ worksite: updated });
}

export async function deleteAdminWorksite(request: Request, response: Response): Promise<void> {
  const clientId = await clientScope(response);
  if (clientId === null) { response.status(401).json({ error: "A client account is required" }); return; }
  const id = String(request.params.id);
  const existing = await prisma.worksite.findFirst({ where: { id, ...(clientId ? { clientId } : {}) }, select: { clientId: true } });
  const deleted = await prisma.worksite.deleteMany({ where: { id, ...(clientId ? { clientId } : {}) } });
  if (deleted.count === 0) { response.status(404).json({ error: "Worksite not found" }); return; }
  await recordAudit({ actorUserId: response.locals.auth.sub, clientId: existing?.clientId, action: "DELETE", entityType: "Worksite", entityId: id });
  response.status(204).send();
}
