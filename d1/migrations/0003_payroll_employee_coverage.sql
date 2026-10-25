ALTER TABLE "PayrollCalculationRun"
ADD COLUMN "expectedEmployeeCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "PayrollCalculationRun"
SET "expectedEmployeeCount" = (
  SELECT COUNT(*)
  FROM "PayrollCalculationResult"
  WHERE "PayrollCalculationResult"."runId" = "PayrollCalculationRun"."id"
);
