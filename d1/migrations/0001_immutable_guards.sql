-- Preserve the immutable-history guarantees currently enforced by PostgreSQL triggers.

CREATE TRIGGER IF NOT EXISTS "AuditLog_immutable_update"
BEFORE UPDATE ON "AuditLog"
BEGIN
  SELECT RAISE(ABORT, 'AuditLog rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS "AuditLog_immutable_delete"
BEFORE DELETE ON "AuditLog"
BEGIN
  SELECT RAISE(ABORT, 'AuditLog rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS "AttendanceEvent_immutable_update"
BEFORE UPDATE ON "AttendanceEvent"
WHEN NOT (
  NEW."id" IS OLD."id"
  AND NEW."employeeId" IS OLD."employeeId"
  AND NEW."clientId" IS OLD."clientId"
  AND NEW."workDate" IS OLD."workDate"
  AND NEW."type" IS OLD."type"
  AND NEW."source" IS OLD."source"
  AND NEW."occurredAt" IS OLD."occurredAt"
  AND NEW."worksiteId" IS OLD."worksiteId"
  AND NEW."distanceMeters" IS OLD."distanceMeters"
  AND NEW."acceptedRadiusMeters" IS OLD."acceptedRadiusMeters"
  AND NEW."idempotencyKey" IS OLD."idempotencyKey"
  AND NEW."createdByUserId" IS OLD."createdByUserId"
  AND NEW."deviceDetails" IS OLD."deviceDetails"
  AND NEW."createdAt" IS OLD."createdAt"
)
OR (NEW."latitude" IS NOT OLD."latitude" AND NEW."latitude" IS NOT NULL)
OR (NEW."longitude" IS NOT OLD."longitude" AND NEW."longitude" IS NOT NULL)
OR (NEW."accuracyMeters" IS NOT OLD."accuracyMeters" AND NEW."accuracyMeters" IS NOT NULL)
BEGIN
  SELECT RAISE(ABORT, 'AttendanceEvent facts are immutable');
END;

CREATE TRIGGER IF NOT EXISTS "AttendanceEvent_immutable_delete"
BEFORE DELETE ON "AttendanceEvent"
BEGIN
  SELECT RAISE(ABORT, 'AttendanceEvent rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS "PayrollMonetaryAdjustment_immutable_update"
BEFORE UPDATE ON "PayrollMonetaryAdjustment"
BEGIN
  SELECT RAISE(ABORT, 'PayrollMonetaryAdjustment rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS "PayrollMonetaryAdjustment_immutable_delete"
BEFORE DELETE ON "PayrollMonetaryAdjustment"
BEGIN
  SELECT RAISE(ABORT, 'PayrollMonetaryAdjustment rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS "PayrollMonetaryAdjustmentDecision_immutable_update"
BEFORE UPDATE ON "PayrollMonetaryAdjustmentDecision"
BEGIN
  SELECT RAISE(ABORT, 'PayrollMonetaryAdjustmentDecision rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS "PayrollMonetaryAdjustmentDecision_immutable_delete"
BEFORE DELETE ON "PayrollMonetaryAdjustmentDecision"
BEGIN
  SELECT RAISE(ABORT, 'PayrollMonetaryAdjustmentDecision rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS "PayrollStatementDelivery_immutable_update"
BEFORE UPDATE ON "PayrollStatementDelivery"
BEGIN
  SELECT RAISE(ABORT, 'PayrollStatementDelivery rows are immutable');
END;

CREATE TRIGGER IF NOT EXISTS "PayrollStatementDelivery_immutable_delete"
BEFORE DELETE ON "PayrollStatementDelivery"
BEGIN
  SELECT RAISE(ABORT, 'PayrollStatementDelivery rows are immutable');
END;
