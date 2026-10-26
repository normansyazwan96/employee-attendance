import { Role } from "@prisma/client";
import { Router } from "express";
import { acknowledgePayrollWarningV2, calculatePayPeriodV2, createPayPeriodV2, createPayrollExportV2, downloadPayPeriodExportV2, downloadPayrollExportV2, getLatestPayPeriodCalculationV2, listPayPeriodsV2, listPayrollExportsV2, transitionPayPeriodV2 } from "../controllers/payroll-v2.controller.js";
import {
  createEmployeePayComponentV2,
  createEmployeeStatutoryProfileV2,
  createPayrollComponentV2,
  createPayProfileV2,
  getPayrollSettingsV2,
  listEmployeePayComponentsV2,
  listEmployeeStatutoryProfilesV2,
  listPayrollComponentsV2,
  listPayrollPermissionsV2,
  listPayProfilesV2,
  updatePayrollPermissionV2,
  updatePayrollSettingsV2,
} from "../controllers/payroll-foundation.controller.js";
import { requireAuth, requireCurrentSession, requirePasswordChangeCompleted, requireRoles } from "../middleware/auth.js";
import { createPayrollAdjustmentV2, decidePayrollAdjustmentV2, downloadMyPayrollStatementPdfV2, downloadMyPayrollStatementV2, emailPayrollStatementV2, getMyPayrollStatementV2, getPayrollDeliveryCapabilitiesV2, listMyPayrollStatementsV2, listPayrollStatementDeliveriesV2, listPayrollStatementsV2, listPendingPayrollAdjustmentsV2 } from "../controllers/payroll-statements.controller.js";

export const payrollV2Router = Router();
payrollV2Router.get("/payroll/my-statements", requireAuth, requireCurrentSession, requirePasswordChangeCompleted, requireRoles(Role.EMPLOYEE), listMyPayrollStatementsV2);
payrollV2Router.get("/payroll/my-statements/:payPeriodId", requireAuth, requireCurrentSession, requirePasswordChangeCompleted, requireRoles(Role.EMPLOYEE), getMyPayrollStatementV2);
payrollV2Router.get("/payroll/my-statements/:payPeriodId/download", requireAuth, requireCurrentSession, requirePasswordChangeCompleted, requireRoles(Role.EMPLOYEE), downloadMyPayrollStatementV2);
payrollV2Router.get("/payroll/my-statements/:payPeriodId/download.pdf", requireAuth, requireCurrentSession, requirePasswordChangeCompleted, requireRoles(Role.EMPLOYEE), downloadMyPayrollStatementPdfV2);
payrollV2Router.use("/payroll", requireAuth, requireCurrentSession, requirePasswordChangeCompleted, requireRoles(Role.ADMIN, Role.DEV_ADMIN));
payrollV2Router.get("/payroll/settings", getPayrollSettingsV2);
payrollV2Router.put("/payroll/settings", updatePayrollSettingsV2);
payrollV2Router.get("/payroll/pay-profiles", listPayProfilesV2);
payrollV2Router.post("/payroll/pay-profiles", createPayProfileV2);
payrollV2Router.get("/payroll/statutory-profiles", listEmployeeStatutoryProfilesV2);
payrollV2Router.post("/payroll/statutory-profiles", createEmployeeStatutoryProfileV2);
payrollV2Router.get("/payroll/components", listPayrollComponentsV2);
payrollV2Router.post("/payroll/components", createPayrollComponentV2);
payrollV2Router.get("/payroll/component-assignments", listEmployeePayComponentsV2);
payrollV2Router.post("/payroll/component-assignments", createEmployeePayComponentV2);
payrollV2Router.get("/payroll/permissions", listPayrollPermissionsV2);
payrollV2Router.patch("/payroll/permissions/:id", updatePayrollPermissionV2);
payrollV2Router.get("/payroll/adjustments/pending", listPendingPayrollAdjustmentsV2);
payrollV2Router.get("/payroll/delivery-capabilities", getPayrollDeliveryCapabilitiesV2);
payrollV2Router.get("/payroll/pay-periods", listPayPeriodsV2);
payrollV2Router.post("/payroll/pay-periods", createPayPeriodV2);
payrollV2Router.post("/payroll/pay-periods/:id/calculate", calculatePayPeriodV2);
payrollV2Router.get("/payroll/pay-periods/:id/calculations/latest", getLatestPayPeriodCalculationV2);
payrollV2Router.post("/payroll/pay-periods/:id/calculations/latest/results/:resultId/warnings/:warningCode/acknowledge", acknowledgePayrollWarningV2);
payrollV2Router.get("/payroll/pay-periods/:id/statements", listPayrollStatementsV2);
payrollV2Router.get("/payroll/pay-periods/:id/statement-deliveries", listPayrollStatementDeliveriesV2);
payrollV2Router.post("/payroll/pay-periods/:id/statements/:resultId/email", emailPayrollStatementV2);
payrollV2Router.post("/payroll/pay-periods/:id/adjustments", createPayrollAdjustmentV2);
payrollV2Router.post("/payroll/pay-periods/:id/adjustments/:adjustmentId/decision", decidePayrollAdjustmentV2);
payrollV2Router.post("/payroll/pay-periods/:id/transition", transitionPayPeriodV2);
payrollV2Router.post("/payroll/pay-periods/:id/exports", createPayrollExportV2);
payrollV2Router.post("/payroll/pay-periods/:id/download", downloadPayPeriodExportV2);
payrollV2Router.get("/payroll/exports", listPayrollExportsV2);
payrollV2Router.get("/payroll/exports/:id/download", downloadPayrollExportV2);
