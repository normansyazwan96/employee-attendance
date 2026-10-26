import { Role } from "@prisma/client";
import { Router } from "express";
import { cancelLeaveRequestV2, createCorrectionV2, createLeaveRequestV2, createLeaveTypeV2, listApprovalInboxV2, listMyCorrectionsV2, listMyLeaveV2, reviewCorrectionV2, reviewLeaveRequestV2, setLeaveBalanceV2 } from "../controllers/requests-v2.controller.js";
import { requireAuth, requireCurrentSession, requirePasswordChangeCompleted, requireRoles } from "../middleware/auth.js";

export const requestsV2Router = Router();
requestsV2Router.use(["/corrections", "/leave", "/workforce"], requireAuth, requireCurrentSession, requirePasswordChangeCompleted);
requestsV2Router.get("/corrections", requireRoles(Role.EMPLOYEE), listMyCorrectionsV2);
requestsV2Router.post("/corrections", requireRoles(Role.EMPLOYEE), createCorrectionV2);
requestsV2Router.get("/leave", requireRoles(Role.EMPLOYEE), listMyLeaveV2);
requestsV2Router.post("/leave/requests", requireRoles(Role.EMPLOYEE), createLeaveRequestV2);
requestsV2Router.post("/leave/requests/:id/cancel", requireRoles(Role.EMPLOYEE), cancelLeaveRequestV2);
requestsV2Router.get("/workforce/approvals", requireRoles(Role.ADMIN, Role.MANAGER, Role.DEV_ADMIN), listApprovalInboxV2);
requestsV2Router.post("/workforce/corrections/:id/review", requireRoles(Role.ADMIN, Role.MANAGER, Role.DEV_ADMIN), reviewCorrectionV2);
requestsV2Router.post("/workforce/leave-requests/:id/review", requireRoles(Role.ADMIN, Role.MANAGER, Role.DEV_ADMIN), reviewLeaveRequestV2);
requestsV2Router.post("/workforce/leave-types", requireRoles(Role.ADMIN, Role.DEV_ADMIN), createLeaveTypeV2);
requestsV2Router.put("/workforce/leave-balances", requireRoles(Role.ADMIN, Role.DEV_ADMIN), setLeaveBalanceV2);
