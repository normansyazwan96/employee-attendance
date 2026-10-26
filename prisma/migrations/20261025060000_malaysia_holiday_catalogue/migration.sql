CREATE TABLE "MalaysiaHoliday" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "stateCode" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'public',
    "importedByUserId" TEXT,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MalaysiaHoliday_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Worksite" ADD COLUMN "stateCode" TEXT;

UPDATE "Worksite" AS worksite
SET "stateCode" = COALESCE(
    (SELECT client."stateCode" FROM "Client" AS client WHERE client."id" = worksite."clientId"),
    '14'
);

ALTER TABLE "Worksite" ALTER COLUMN "stateCode" SET DEFAULT '14';
ALTER TABLE "Worksite" ALTER COLUMN "stateCode" SET NOT NULL;

CREATE UNIQUE INDEX "MalaysiaHoliday_year_stateCode_date_name_key"
ON "MalaysiaHoliday"("year", "stateCode", "date", "name");

CREATE INDEX "MalaysiaHoliday_year_date_stateCode_idx"
ON "MalaysiaHoliday"("year", "date", "stateCode");
