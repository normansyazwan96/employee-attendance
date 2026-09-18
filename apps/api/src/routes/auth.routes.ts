import { Router } from "express";
import { login } from "../controllers/auth.controller.js";
import { loginRateLimit } from "../middleware/login-rate-limit.js";
import { getProfile, updateProfile } from "../controllers/profile.controller.js";
import { requireAuth, requireCurrentSession } from "../middleware/auth.js";

export const authRouter = Router();
authRouter.post("/auth/login", loginRateLimit, login);
authRouter.get("/profile", requireAuth, requireCurrentSession, getProfile);
authRouter.patch("/profile", requireAuth, requireCurrentSession, updateProfile);
