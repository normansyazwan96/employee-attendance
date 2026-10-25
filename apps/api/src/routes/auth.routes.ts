import { Router } from "express";
import { loginV1 } from "../controllers/auth-v2.controller.js";
import { loginRateLimit } from "../middleware/login-rate-limit.js";
import { getProfile, updateProfile } from "../controllers/profile.controller.js";
import { requireAuth, requireCurrentSession } from "../middleware/auth.js";

export const authRouter = Router();
authRouter.post("/auth/login", loginRateLimit, loginV1);
authRouter.get("/profile", requireAuth, requireCurrentSession, getProfile);
authRouter.patch("/profile", requireAuth, requireCurrentSession, updateProfile);
