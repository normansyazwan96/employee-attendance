BEGIN;

CREATE TYPE "PayrollAdjustmentDecisionOutcome" AS ENUM ('APPROVED', 'REJECTED');

CREATE TABLE "PayrollMonetaryAdjustmentDecision" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "adjustmentId" TEXT NOT NULL,
  "outcome" "PayrollAdjustmentDecisionOutcome" NOT NULL,
  "note" TEXT NOT NULL,
  "decidedByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollMonetaryAdjustmentDecision_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PayrollMonetaryAdjustmentDecision_adjustmentId_key" ON "PayrollMonetaryAdjustmentDecision"("adjustmentId");
CREATE INDEX "PayrollMonetaryAdjustmentDecision_clientId_outcome_createdAt_idx" ON "PayrollMonetaryAdjustmentDecision"("clientId", "outcome", "createdAt");
CREATE INDEX "PayrollMonetaryAdjustmentDecision_decidedByUserId_createdAt_idx" ON "PayrollMonetaryAdjustmentDecision"("decidedByUserId", "createdAt");

ALTER TABLE "PayrollMonetaryAdjustmentDecision" ADD CONSTRAINT "PayrollMonetaryAdjustmentDecision_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollMonetaryAdjustmentDecision" ADD CONSTRAINT "PayrollMonetaryAdjustmentDecision_adjustmentId_fkey" FOREIGN KEY ("adjustmentId") REFERENCES "PayrollMonetaryAdjustment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Preserve the effect of adjustments created before approvals were introduced.
INSERT INTO "PayrollMonetaryAdjustmentDecision" ("id", "clientId", "adjustmentId", "outcome", "note", "decidedByUserId", "createdAt")
SELECT 'legacy_' || md5("id"), "clientId", "id", 'APPROVED', 'Approved before the two-person approval workflow was introduced', "createdByUserId", "createdAt"
FROM "PayrollMonetaryAdjustment";

CREATE OR REPLACE FUNCTION prevent_payroll_adjustment_decision_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'PayrollMonetaryAdjustmentDecision rows are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "PayrollMonetaryAdjustmentDecision_immutable_update"
BEFORE UPDATE ON "PayrollMonetaryAdjustmentDecision"
FOR EACH ROW EXECUTE FUNCTION prevent_payroll_adjustment_decision_mutation();

CREATE TRIGGER "PayrollMonetaryAdjustmentDecision_immutable_delete"
BEFORE DELETE ON "PayrollMonetaryAdjustmentDecision"
FOR EACH ROW EXECUTE FUNCTION prevent_payroll_adjustment_decision_mutation();

COMMIT;
