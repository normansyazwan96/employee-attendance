import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../services/prisma.js";
import { logger } from "../services/logger.js";

const healthResponseSchema = z.object({ status: z.literal("ok") });
const readinessResponseSchema = z.object({
  status: z.enum(["ok", "unavailable"]),
  checks: z.object({ database: z.enum(["ok", "unavailable"]) }),
  requestId: z.string(),
});

export function getHealth(_request: Request, response: Response): void {
  response.status(200).json(healthResponseSchema.parse({ status: "ok" }));
}

export function getLiveness(_request: Request, response: Response): void {
  response.status(200).json({ status: "ok", requestId: response.locals.requestId });
}

export async function getReadiness(_request: Request, response: Response): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.status(200).json(readinessResponseSchema.parse({
      status: "ok",
      checks: { database: "ok" },
      requestId: response.locals.requestId,
    }));
  } catch (error) {
    logger.warn("readiness_check_failed", {
      requestId: response.locals.requestId,
      message: error instanceof Error ? error.message : "Unknown database error",
    });
    response.status(503).json(readinessResponseSchema.parse({
      status: "unavailable",
      checks: { database: "unavailable" },
      requestId: response.locals.requestId,
    }));
  }
}
