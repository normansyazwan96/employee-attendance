import { authenticatedFetch } from "./auth";
import type { PayPeriodStatus, PayrollCalculationLine, PayrollEmployee } from "./payroll";

export type PayrollMonetaryAdjustment = {
  id: string;
  direction: "EARNING" | "DEDUCTION";
  code: string;
  name: string;
  amountSen: number;
  reason: string;
  createdAt: string;
  createdByUserId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decision: { id: string; outcome: "APPROVED" | "REJECTED"; note: string; decidedByUserId: string; createdAt: string } | null;
};

export type PendingPayrollAdjustment = PayrollMonetaryAdjustment & {
  employee: { id: string; firstName: string; lastName: string; employeeNumber: string | null; user: { username: string } };
  payPeriod: { id: string; name: string; startDate: string; endDate: string };
  createdBy: { id: string; username: string; displayName: string | null } | null;
};

export type PayrollStatement = {
  id: string;
  organizationName: string;
  period: { id: string; name: string; startDate: string; endDate: string; status: PayPeriodStatus };
  calculation: { version: number; rulePackVersion: string; lockedAt: string | null; grossPaySen: number; totalDeductionsSen: number; calculatedPaySen: number; employerContributionsSen: number; lines: PayrollCalculationLine[] };
  employee: Omit<PayrollEmployee, "user"> & { userId: string; username: string; contactEmail: string | null };
  adjustments: PayrollMonetaryAdjustment[];
  adjustmentEarningsSen: number;
  adjustmentDeductionsSen: number;
  finalCalculatedPaySen: number;
};

export type PayrollStatementDelivery = {
  id: string;
  payPeriodId: string;
  calculationResultId: string;
  employeeId: string;
  recipientEmail: string;
  language: "en" | "ms";
  fileName: string;
  status: "SENT" | "FAILED";
  failureReason: string | null;
  createdAt: string;
  employee: { firstName: string; lastName: string; user: { username: string } };
};

async function responseBody<T>(response: Response): Promise<T> {
  const result = await response.json() as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(result.error?.message ?? "Payroll statement request failed");
  return result;
}

export async function getMyPayrollStatements(): Promise<PayrollStatement[]> {
  return (await responseBody<{ data: PayrollStatement[] }>(await authenticatedFetch("/api/v2/payroll/my-statements"))).data;
}

export async function getPayrollStatements(payPeriodId: string): Promise<PayrollStatement[]> {
  return (await responseBody<{ data: PayrollStatement[] }>(await authenticatedFetch(`/api/v2/payroll/pay-periods/${payPeriodId}/statements`))).data;
}

export async function createPayrollAdjustment(payPeriodId: string, input: { employeeId: string; direction: "EARNING" | "DEDUCTION"; code: string; name: string; amountSen: number; reason: string }): Promise<PayrollMonetaryAdjustment> {
  return (await responseBody<{ data: PayrollMonetaryAdjustment }>(await authenticatedFetch(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }))).data;
}

export async function getPendingPayrollAdjustments(payPeriodId?: string): Promise<PendingPayrollAdjustment[]> {
  const query = payPeriodId ? `?payPeriodId=${encodeURIComponent(payPeriodId)}` : "";
  return (await responseBody<{ data: PendingPayrollAdjustment[] }>(await authenticatedFetch(`/api/v2/payroll/adjustments/pending${query}`))).data;
}

export async function decidePayrollAdjustment(payPeriodId: string, adjustmentId: string, input: { outcome: "APPROVED" | "REJECTED"; note: string }): Promise<void> {
  await responseBody(await authenticatedFetch(`/api/v2/payroll/pay-periods/${payPeriodId}/adjustments/${adjustmentId}/decision`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  }));
}

export async function getPayrollDeliveryCapabilities(): Promise<{ emailConfigured: boolean }> {
  return (await responseBody<{ data: { emailConfigured: boolean } }>(await authenticatedFetch("/api/v2/payroll/delivery-capabilities"))).data;
}

export async function getPayrollStatementDeliveries(payPeriodId: string): Promise<PayrollStatementDelivery[]> {
  return (await responseBody<{ data: PayrollStatementDelivery[] }>(await authenticatedFetch(`/api/v2/payroll/pay-periods/${payPeriodId}/statement-deliveries`))).data;
}

export async function emailPayrollStatement(payPeriodId: string, resultId: string, language: "en" | "ms"): Promise<PayrollStatementDelivery> {
  return (await responseBody<{ data: PayrollStatementDelivery }>(await authenticatedFetch(`/api/v2/payroll/pay-periods/${payPeriodId}/statements/${resultId}/email`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ language }) }))).data;
}

export async function downloadMyPayrollStatement(payPeriodId: string, language: "en" | "ms"): Promise<void> {
  const response = await authenticatedFetch(`/api/v2/payroll/my-statements/${payPeriodId}/download.pdf`, { headers: { "Accept-Language": language } });
  if (!response.ok) {
    const result = await response.json() as { error?: { message?: string } };
    throw new Error(result.error?.message ?? "Unable to download payroll statement");
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "payroll-statement.pdf";
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
