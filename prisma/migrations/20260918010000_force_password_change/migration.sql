ALTER TABLE "User"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "passwordVersion" INTEGER NOT NULL DEFAULT 0;

UPDATE "User" SET "mustChangePassword" = true;
