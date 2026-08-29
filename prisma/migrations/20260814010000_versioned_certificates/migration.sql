-- Preserve every revoked credential while allowing a replacement certificate.
-- PostgreSQL enforces that each enrollment has at most one current Issued row.
DROP INDEX IF EXISTS "certificates_enrollment_id_key";

CREATE INDEX "certificates_enrollment_id_status_issued_date_idx"
ON "certificates" ("enrollment_id", "status", "issued_date" DESC);

CREATE UNIQUE INDEX "certificates_one_issued_per_enrollment_key"
ON "certificates" ("enrollment_id")
WHERE "status" = 'ISSUED';
