-- Version authenticated sessions so password/security changes can revoke
-- already-issued stateless JWT cookies.
ALTER TABLE "users"
  ADD COLUMN "security_version" INTEGER NOT NULL DEFAULT 0;

-- Email identity is case-insensitive. Normalize the clean development data
-- before enforcing the database-level invariant.
UPDATE "users" SET "email" = lower(btrim("email"));
CREATE UNIQUE INDEX "users_email_normalized_key" ON "users" (lower("email"));

-- Short-lived second-factor challenges for privileged logins.
CREATE TABLE "login_challenges" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "login_challenges_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "login_challenges_attempts_check"
    CHECK ("attempts" >= 0)
);
CREATE INDEX "login_challenges_user_id_created_at_idx"
  ON "login_challenges" ("user_id", "created_at" DESC);
CREATE INDEX "login_challenges_expires_at_idx"
  ON "login_challenges" ("expires_at");

-- Support foreign-key checks and deletion paths without scans.
CREATE INDEX "student_projects_enrollment_id_idx"
  ON "student_projects" ("enrollment_id");
CREATE INDEX "audit_logs_actor_user_id_idx"
  ON "audit_logs" ("actor_user_id");
