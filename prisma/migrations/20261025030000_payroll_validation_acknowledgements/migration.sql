ALTER TABLE "PayPeriod"
ADD COLUMN "reviewedCalculationRunId" TEXT,
ADD COLUMN "approvedCalculationRunId" TEXT;

CREATE TABLE "PayrollWarningAcknowledgement" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "calculationResultId" TEXT NOT NULL,
  "warningCode" TEXT NOT NULL,
  "note" TEXT NOT NULL,
  "acknowledgedByUserId" TEXT NOT NULL,
  "acknowledgedByUsername" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PayrollWarningAcknowledgement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollWarningAcknowledgement_note_length" CHECK (char_length("note") BETWEEN 3 AND 500)
);

CREATE UNIQUE INDEX "PayrollWarningAcknowledgement_calculationResultId_warningCode_key"
ON "PayrollWarningAcknowledgement"("calculationResultId", "warningCode");

CREATE INDEX "PayrollWarningAcknowledgement_clientId_createdAt_idx"
ON "PayrollWarningAcknowledgement"("clientId", "createdAt");

CREATE INDEX "PayrollWarningAcknowledgement_acknowledgedByUserId_createdAt_idx"
ON "PayrollWarningAcknowledgement"("acknowledgedByUserId", "createdAt");

ALTER TABLE "PayrollWarningAcknowledgement"
ADD CONSTRAINT "PayrollWarningAcknowledgement_clientId_fkey"
FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PayrollWarningAcknowledgement"
ADD CONSTRAINT "PayrollWarningAcknowledgement_calculationResultId_fkey"
FOREIGN KEY ("calculationResultId") REFERENCES "PayrollCalculationResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
