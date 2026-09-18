ALTER TABLE "User" ADD COLUMN "username" TEXT;

UPDATE "User"
SET "username" = CASE
  WHEN "email" = 'devadmin@attendance.local' THEN 'devadmin'
  WHEN "email" = 'admin@acme.local' THEN 'admin'
  WHEN "email" = 'john.smith@acme.local' THEN 'john.smith'
  ELSE LEFT(
    COALESCE(NULLIF(REGEXP_REPLACE(LOWER(SPLIT_PART(COALESCE("email", ''), '@', 1)), '[^a-z0-9._-]', '', 'g'), ''), 'user'),
    30
  ) || '-' || SUBSTRING(MD5("id") FROM 1 FOR 8)
END;

ALTER TABLE "User" ALTER COLUMN "username" SET NOT NULL;
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
DROP INDEX "User_email_key";
ALTER TABLE "User" DROP COLUMN "email";
