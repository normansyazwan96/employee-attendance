ALTER TABLE "User" ADD COLUMN "createdByUserId" TEXT;

CREATE INDEX "User_createdByUserId_idx" ON "User"("createdByUserId");

ALTER TABLE "User"
ADD CONSTRAINT "User_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "User" AS employee
SET "createdByUserId" = owner."adminId"
FROM (
  SELECT "clientId", MIN("id") AS "adminId"
  FROM "User"
  WHERE "role" = 'ADMIN' AND "clientId" IS NOT NULL
  GROUP BY "clientId"
  HAVING COUNT(*) = 1
) AS owner
WHERE employee."role" = 'EMPLOYEE'
  AND employee."createdByUserId" IS NULL
  AND employee."clientId" = owner."clientId";
