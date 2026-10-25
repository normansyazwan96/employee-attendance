ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isGlobalAdmin" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "User_single_active_dev_admin"
ON "User" ("role")
WHERE "role" = 'DEV_ADMIN' AND "isActive" = true;

CREATE INDEX IF NOT EXISTS "User_isGlobalAdmin_isActive_idx"
ON "User" ("isGlobalAdmin", "isActive");
