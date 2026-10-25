ALTER TABLE "PayrollCalculationRun"
ADD COLUMN "expectedEmployeeCount" INTEGER NOT NULL DEFAULT 0;

UPDATE "PayrollCalculationRun" AS run
SET "expectedEmployeeCount" = (
    SELECT COUNT(*)
    FROM "PayrollCalculationResult" AS result
    WHERE result."runId" = run."id"
);
