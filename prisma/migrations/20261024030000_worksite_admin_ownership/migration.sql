BEGIN;

ALTER TABLE "Worksite" ADD COLUMN "ownerAdminId" TEXT;

UPDATE "Worksite" AS worksite
SET "ownerAdminId" = creator."actorUserId"
FROM (
  SELECT DISTINCT ON (audit."entityId")
    audit."entityId",
    audit."actorUserId",
    actor."clientId" AS "actorClientId"
  FROM "AuditLog" AS audit
  INNER JOIN "User" AS actor ON actor."id" = audit."actorUserId"
  WHERE audit."entityType" = 'Worksite'
    AND audit."action" = 'CREATE'
    AND actor."role" = 'ADMIN'
  ORDER BY audit."entityId", audit."createdAt" ASC
) AS creator
WHERE worksite."id" = creator."entityId"
  AND worksite."clientId" = creator."actorClientId";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Worksite" AS worksite
    WHERE worksite."ownerAdminId" IS NULL
      AND NOT (worksite."clientId" = 'acme-local' AND worksite."name" = 'Acme Local HQ')
      AND NOT EXISTS (
        SELECT 1
        FROM "AuditLog" AS audit
        INNER JOIN "User" AS actor ON actor."id" = audit."actorUserId"
        WHERE audit."entityType" = 'Worksite'
          AND audit."entityId" = worksite."id"
          AND actor."role" = 'DEV_ADMIN'
      )
  ) THEN
    RAISE EXCEPTION 'Worksite ownership migration found an unclassified legacy worksite';
  END IF;
END $$;

DROP INDEX "Worksite_clientId_name_key";

CREATE UNIQUE INDEX "Worksite_organization_name_key"
ON "Worksite"("clientId", "name")
WHERE "ownerAdminId" IS NULL;

CREATE UNIQUE INDEX "Worksite_ownerAdminId_name_key"
ON "Worksite"("ownerAdminId", "name")
WHERE "ownerAdminId" IS NOT NULL;

CREATE INDEX "Worksite_clientId_ownerAdminId_isActive_idx"
ON "Worksite"("clientId", "ownerAdminId", "isActive");

ALTER TABLE "Worksite"
ADD CONSTRAINT "Worksite_ownerAdminId_fkey"
FOREIGN KEY ("ownerAdminId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
