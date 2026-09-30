-- Public student profiles: an opt-in portfolio page a student sets up the
-- first time they submit a project. Visible publicly only after consent and
-- a first approved public project. The avatar is an R2 public object (one per
-- student; the old file is deleted from R2 when replaced). See the
-- 2026-10-01 public student profile plan.
ALTER TYPE "StoredObjectPurpose" ADD VALUE 'STUDENT_AVATAR';

CREATE TABLE "student_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "headline" TEXT,
    "bio" TEXT,
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "career_goals" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedin_url" TEXT,
    "github_url" TEXT,
    "portfolio_url" TEXT,
    "avatar_object_id" TEXT,
    "publish_consent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "student_profiles_user_id_key" ON "student_profiles"("user_id");
CREATE UNIQUE INDEX "student_profiles_slug_key" ON "student_profiles"("slug");
CREATE UNIQUE INDEX "student_profiles_avatar_object_id_key" ON "student_profiles"("avatar_object_id");

ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_avatar_object_id_fkey" FOREIGN KEY ("avatar_object_id") REFERENCES "stored_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
