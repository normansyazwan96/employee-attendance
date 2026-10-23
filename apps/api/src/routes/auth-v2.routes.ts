import { Router } from "express";
import { loginRateLimit } from "../middleware/login-rate-limit.js";
import { requireAuth, requireCurrentSession } from "../middleware/auth.js";
import { enableMfaV2, listSessionsV2, loginV2, logoutV2, refreshV2, revokeSessionV2, setupMfaV2, verifyMfaLoginV2 } from "../controllers/auth-v2.controller.js";
import { requestPasswordResetV2, resetPasswordV2 } from "../controllers/password-recovery.controller.js";

export const authV2Router = Router();

authV2Router.post("/auth/login", loginRateLimit, loginV2);
authV2Router.post("/auth/2fa/verify-login", loginRateLimit, verifyMfaLoginV2);
authV2Router.post("/auth/refresh", refreshV2);
authV2Router.post("/auth/password-recovery", loginRateLimit, requestPasswordResetV2);
authV2Router.post("/auth/password-reset", loginRateLimit, resetPasswordV2);
authV2Router.post("/auth/logout", logoutV2);
authV2Router.post("/auth/2fa/setup", requireAuth, requireCurrentSession, setupMfaV2);
authV2Router.post("/auth/2fa/enable", requireAuth, requireCurrentSession, enableMfaV2);
authV2Router.get("/auth/sessions", requireAuth, requireCurrentSession, listSessionsV2);
authV2Router.delete("/auth/sessions/:id", requireAuth, requireCurrentSession, revokeSessionV2);
