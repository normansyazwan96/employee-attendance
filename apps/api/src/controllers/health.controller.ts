import type { Request, Response } from "express";
import { z } from "zod";

const healthResponseSchema = z.object({ status: z.literal("ok") });

export function getHealth(_request: Request, response: Response): void {
  response.status(200).json(healthResponseSchema.parse({ status: "ok" }));
}
