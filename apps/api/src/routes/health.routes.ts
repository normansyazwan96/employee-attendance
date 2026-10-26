import { Router } from "express";
import { getHealth, getLiveness, getReadiness } from "../controllers/health.controller.js";

export const healthRouter = Router();
healthRouter.get("/health", getHealth);

export const healthV2Router = Router();
healthV2Router.get("/health/live", getLiveness);
healthV2Router.get("/health/ready", getReadiness);
