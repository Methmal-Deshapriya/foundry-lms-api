-- Support indexed case-insensitive substring search used by cursor-paginated
-- roster and certificate administration endpoints.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "users_first_name_trgm_idx"
  ON "users" USING GIN ("first_name" gin_trgm_ops);
CREATE INDEX "users_last_name_trgm_idx"
  ON "users" USING GIN ("last_name" gin_trgm_ops);
CREATE INDEX "users_email_trgm_idx"
  ON "users" USING GIN ("email" gin_trgm_ops);

CREATE INDEX "certificates_code_trgm_idx"
  ON "certificates" USING GIN ("certificate_code" gin_trgm_ops);
CREATE INDEX "certificates_student_name_trgm_idx"
  ON "certificates" USING GIN ("student_name" gin_trgm_ops);
CREATE INDEX "certificates_course_name_trgm_idx"
  ON "certificates" USING GIN ("course_name" gin_trgm_ops);

CREATE INDEX "enrollments_course_id_created_at_id_idx"
  ON "enrollments" ("course_id", "created_at" DESC, "id" DESC);
CREATE INDEX "enrollments_batch_id_created_at_id_idx"
  ON "enrollments" ("batch_id", "created_at" DESC, "id" DESC);
CREATE INDEX "certificates_created_at_id_idx"
  ON "certificates" ("created_at" DESC, "id" DESC);

-- A READY session is attachable curriculum, so it must have playable content.
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_ready_recording_check"
  CHECK (
    "status" <> 'READY'
    OR ("recording_url" IS NOT NULL AND char_length(btrim("recording_url")) > 0)
  ) NOT VALID;
ALTER TABLE "sessions" VALIDATE CONSTRAINT "sessions_ready_recording_check";

-- Keep certificate status and revocation metadata aligned even if data is
-- changed outside the API.
ALTER TABLE "certificates"
  ADD CONSTRAINT "certificates_revocation_state_check"
  CHECK (
    (
      "status" = 'ISSUED'
      AND "revoked_at" IS NULL
      AND "revoked_by" IS NULL
      AND "revocation_reason" IS NULL
    )
    OR
    (
      "status" = 'REVOKED'
      AND "revoked_at" IS NOT NULL
      AND "revoked_by" IS NOT NULL
      AND char_length(btrim("revocation_reason")) > 0
    )
  ) NOT VALID;
ALTER TABLE "certificates" VALIDATE CONSTRAINT "certificates_revocation_state_check";
