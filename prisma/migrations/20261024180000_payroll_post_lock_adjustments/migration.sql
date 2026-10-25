BEGIN;

CREATE TYPE "PayrollAdjustmentDirection" AS ENUM ('EARNING', 'DEDUCTION');

CREATE TABLE "PayrollMonetaryAdjustment" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "payPeriodId" TEXT NOT NULL,
  "calculationResultId" TEXT NOT NULL,
  "employeeId" TEXT NOT NULL,
  "direction" "PayrollAdjustmentDirection" NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "amountSen" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollMonetaryAdjustment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PayrollMonetaryAdjustment_clientId_payPeriodId_createdAt_idx" ON "PayrollMonetaryAdjustment"("clientId", "payPeriodId", "createdAt");
CREATE INDEX "PayrollMonetaryAdjustment_employeeId_payPeriodId_createdAt_idx" ON "PayrollMonetaryAdjustment"("employeeId", "payPeriodId", "createdAt");
CREATE INDEX "PayrollMonetaryAdjustment_calculationResultId_createdAt_idx" ON "PayrollMonetaryAdjustment"("calculationResultId", "createdAt");

ALTER TABLE "PayrollMonetaryAdjustment" ADD CONSTRAINT "PayrollMonetaryAdjustment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollMonetaryAdjustment" ADD CONSTRAINT "PayrollMonetaryAdjustment_payPeriodId_fkey" FOREIGN KEY ("payPeriodId") REFERENCES "PayPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PayrollMonetaryAdjustment" ADD CONSTRAINT "PayrollMonetaryAdjustment_calculationResultId_fkey" FOREIGN KEY ("calculationResultId") REFERENCES "PayrollCalculationResult"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollMonetaryAdjustment" ADD CONSTRAINT "PayrollMonetaryAdjustment_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION prevent_payroll_monetary_adjustment_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PayrollMonetaryAdjustment rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollMonetaryAdjustment_immutable_update"
BEFORE UPDATE ON "PayrollMonetaryAdjustment"
FOR EACH ROW EXECUTE FUNCTION prevent_payroll_monetary_adjustment_mutation();

CREATE TRIGGER "PayrollMonetaryAdjustment_immutable_delete"
BEFORE DELETE ON "PayrollMonetaryAdjustment"
FOR EACH ROW EXECUTE FUNCTION prevent_payroll_monetary_adjustment_mutation();

COMMIT;
