ALTER TABLE "User" ADD COLUMN "isGlobalAdmin" INTEGER NOT NULL DEFAULT 0 CHECK ("isGlobalAdmin" IN (0, 1));

CREATE UNIQUE INDEX IF NOT EXISTS "User_single_active_dev_admin"
ON "User" ("role")
WHERE "role" = 'DEV_ADMIN' AND "isActive" = 1;

CREATE INDEX IF NOT EXISTS "User_isGlobalAdmin_isActive_idx"
ON "User" ("isGlobalAdmin", "isActive");
