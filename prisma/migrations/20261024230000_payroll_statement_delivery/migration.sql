BEGIN;

CREATE TYPE "PayrollStatementDeliveryStatus" AS ENUM ('SENT', 'FAILED');

CREATE TABLE "PayrollStatementDelivery" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "payPeriodId" TEXT NOT NULL,
  "calculationResultId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "recipientEmail" TEXT NOT NULL,
  "language" TEXT NOT NULL DEFAULT 'en',
  "fileName" TEXT NOT NULL,
  "status" "PayrollStatementDeliveryStatus" NOT NULL,
  "providerMessageId" TEXT,
  "failureReason" TEXT,
  "requestedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollStatementDelivery_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollStatementDelivery_clientId_payPeriodId_createdAt_idx" ON "PayrollStatementDelivery"("clientId", "payPeriodId", "createdAt");
CREATE INDEX "PayrollStatementDelivery_employeeId_payPeriodId_createdAt_idx" ON "PayrollStatementDelivery"("employeeId", "payPeriodId", "createdAt");
CREATE INDEX "PayrollStatementDelivery_requestedByUserId_createdAt_idx" ON "PayrollStatementDelivery"("requestedByUserId", "createdAt");

ALTER TABLE "PayrollStatementDelivery" ADD CONSTRAINT "PayrollStatementDelivery_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollStatementDelivery" ADD CONSTRAINT "PayrollStatementDelivery_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollStatementDelivery" ADD CONSTRAINT "PayrollStatementDelivery_calculationResultId_fkey" FOREIGN KEY ("calculationResultId") REFERENCES "PayrollCalculationResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollStatementDelivery" ADD CONSTRAINT "PayrollStatementDelivery_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_payroll_statement_delivery_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PayrollStatementDelivery rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollStatementDelivery_immutable_update"
BEFORE UPDATE ON "PayrollStatementDelivery"
FOR EACH ROW EXECUTE FUNCTION prevent_payroll_statement_delivery_mutation();

CREATE TRIGGER "PayrollStatementDelivery_immutable_delete"
BEFORE DELETE ON "PayrollStatementDelivery"
FOR EACH ROW EXECUTE FUNCTION prevent_payroll_statement_delivery_mutation();

COMMIT;
