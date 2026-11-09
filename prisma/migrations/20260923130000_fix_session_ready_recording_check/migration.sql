-- The 2026-08-15 hardening migration added sessions_ready_recording_check
-- to require a non-empty recording_url before a session could go READY.
-- The R2 storage feature added recording_object_id as an equally valid
-- source of a playable recording (application code already accepts
-- either), but never updated this DB-level constraint to match, so
-- marking an R2-backed session READY fails with a raw check-constraint
-- violation. Postgres has no ALTER CONSTRAINT for a CHECK clause, so the
-- old constraint is dropped and replaced.
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_ready_recording_check";

ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_ready_recording_check"
  CHECK (
    "status" <> 'READY'
    OR ("recording_url" IS NOT NULL AND char_length(btrim("recording_url")) > 0)
    OR "recording_object_id" IS NOT NULL
  ) NOT VALID;
ALTER TABLE "sessions" VALIDATE CONSTRAINT "sessions_ready_recording_check";
