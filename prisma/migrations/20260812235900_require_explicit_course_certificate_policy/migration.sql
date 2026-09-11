-- Course certificate support is an explicit academic policy decision.
-- Removing the database default prevents non-API writers from silently
-- creating certificate-disabled courses when the policy was omitted.
ALTER TABLE "courses"
ALTER COLUMN "certificate_enabled" DROP DEFAULT;
