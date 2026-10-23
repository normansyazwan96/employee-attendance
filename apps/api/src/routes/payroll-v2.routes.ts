import { Role } from "@prisma/client";
import { Router } from "express";
import { createPayPeriodV2, createPayrollExportV2, downloadPayrollExportV2, listPayPeriodsV2, listPayrollExportsV2, transitionPayPeriodV2 } from "../controllers/payroll-v2.controller.js";
import { requireAuth, requireCurrentSession, requirePasswordChangeCompleted, requireRoles } from "../middleware/auth.js";

export const payrollV2Router = Router();
payrollV2Router.use("/payroll", requireAuth, requireCurrentSession, requirePasswordChangeCompleted, requireRoles(Role.ADMIN, Role.DEV_ADMIN));
payrollV2Router.get("/payroll/pay-periods", listPayPeriodsV2);
payrollV2Router.post("/payroll/pay-periods", createPayPeriodV2);
payrollV2Router.post("/payroll/pay-periods/:id/transition", transitionPayPeriodV2);
payrollV2Router.post("/payroll/pay-periods/:id/exports", createPayrollExportV2);
payrollV2Router.get("/payroll/exports", listPayrollExportsV2);
payrollV2Router.get("/payroll/exports/:id/download", downloadPayrollExportV2);
