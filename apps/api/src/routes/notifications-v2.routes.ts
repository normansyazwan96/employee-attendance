import { Router } from "express";
import { listNotificationsV2, markNotificationReadV2 } from "../controllers/notifications-v2.controller.js";
import { requireAuth, requireCurrentSession, requirePasswordChangeCompleted } from "../middleware/auth.js";

export const notificationsV2Router = Router();
notificationsV2Router.use("/notifications", requireAuth, requireCurrentSession, requirePasswordChangeCompleted);
notificationsV2Router.get("/notifications", listNotificationsV2);
notificationsV2Router.post("/notifications/:id/read", markNotificationReadV2);
