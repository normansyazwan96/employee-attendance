CREATE TABLE "MalaysiaHoliday" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "year" INTEGER NOT NULL,
  "stateCode" TEXT NOT NULL,
  "date" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'public',
  "importedByUserId" TEXT,
  "importedAt" INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE ("year", "stateCode", "date", "name")
);

CREATE INDEX "idx_MalaysiaHoliday_year_date_stateCode"
ON "MalaysiaHoliday"("year", "date", "stateCode");

ALTER TABLE "Worksite" ADD COLUMN "stateCode" TEXT NOT NULL DEFAULT '14';

UPDATE "Worksite"
SET "stateCode" = COALESCE(
  (SELECT "Client"."stateCode" FROM "Client" WHERE "Client"."id" = "Worksite"."clientId"),
  '14'
);
