/*
  This is an intentionally breaking development migration.

  The existing course-owned session, enrollment, completion, certificate, and
  project rows are disposable seed data. Rebuilding these tables gives the new
  service-aware delivery model clean constraints instead of preserving invalid
  course-wide publication semantics.
*/

-- CreateEnum
CREATE TYPE "SessionReusePolicy" AS ENUM ('SINGLE_COURSE', 'REUSABLE');

-- CreateEnum
CREATE TYPE "SessionStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'ENROLLING', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "EnrollmentSource" AS ENUM ('ADMIN', 'SELF');

-- Drop the development-only delivery graph in dependency order.
DROP TABLE "session_completions";
DROP TABLE "certificates";
DROP TABLE "student_projects";
DROP TABLE "enrollments";
DROP TABLE "sessions";

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "recording_url" TEXT,
    "material_url" TEXT,
    "quiz_url" TEXT,
    "feedback_url" TEXT,
    "duration_minutes" INTEGER,
    "reuse_policy" "SessionReusePolicy" NOT NULL,
    "status" "SessionStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_duration_minutes_check" CHECK (
      "duration_minutes" IS NULL OR "duration_minutes" > 0
    )
);

-- CreateTable
CREATE TABLE "course_sessions" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "order_index" INTEGER,
    "retired_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "course_sessions_lifecycle_check" CHECK (
      ("retired_at" IS NULL AND "order_index" IS NOT NULL AND "order_index" >= 0)
      OR ("retired_at" IS NOT NULL AND "order_index" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "batches" (
    "id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "expected_end_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Colombo',
    "capacity" INTEGER,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "batches_dates_check" CHECK ("expected_end_date" >= "start_date"),
    CONSTRAINT "batches_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0),
    CONSTRAINT "batches_timezone_check" CHECK (char_length(trim("timezone")) > 0)
);

-- CreateTable
CREATE TABLE "enrollments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "source" "EnrollmentSource" NOT NULL,
    "enrolled_by_user_id" TEXT,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "payment_completed_at" TIMESTAMP(3),
    "external_payment_reference" TEXT,
    "payment_note" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "enrollments_delivery_shape_check" CHECK (
      ("batch_id" IS NULL AND "source" = 'SELF' AND "enrolled_by_user_id" IS NULL)
      OR ("batch_id" IS NOT NULL AND "source" = 'ADMIN' AND "enrolled_by_user_id" IS NOT NULL)
    ),
    CONSTRAINT "enrollments_payment_mode_check" CHECK (
      ("source" = 'SELF' AND "payment_status" = 'NOT_REQUIRED')
      OR ("source" = 'ADMIN' AND "payment_status" <> 'NOT_REQUIRED')
    ),
    CONSTRAINT "enrollments_payment_completed_at_check" CHECK (
      ("payment_status" = 'COMPLETED' AND "payment_completed_at" IS NOT NULL)
      OR ("payment_status" <> 'COMPLETED' AND "payment_completed_at" IS NULL)
    ),
    CONSTRAINT "enrollments_completed_at_check" CHECK (
      ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
      OR ("status" <> 'COMPLETED' AND "completed_at" IS NULL)
    )
);

-- CreateTable
CREATE TABLE "batch_sessions" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "course_session_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "is_released" BOOLEAN NOT NULL DEFAULT false,
    "available_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "batch_sessions_order_index_check" CHECK ("order_index" >= 0)
);

-- CreateTable
CREATE TABLE "session_completions" (
    "id" TEXT NOT NULL,
    "course_session_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "certificate_code" TEXT NOT NULL,
    "student_name" TEXT NOT NULL,
    "course_name" TEXT NOT NULL,
    "description" TEXT,
    "issued_date" TIMESTAMP(3) NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ISSUED',
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "certificate_data" JSONB NOT NULL,
    "snapshot_url" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "thumbnail_url" TEXT,
    "project_url" TEXT,
    "github_url" TEXT,
    "demo_url" TEXT,
    "technologies" JSONB NOT NULL DEFAULT '[]',
    "status" "ProjectStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "admin_feedback" TEXT,
    "is_public" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "like_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_projects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_status_updated_at_idx" ON "sessions"("status", "updated_at" DESC);
CREATE INDEX "sessions_reuse_policy_status_idx" ON "sessions"("reuse_policy", "status");

CREATE UNIQUE INDEX "course_sessions_id_course_id_key" ON "course_sessions"("id", "course_id");
CREATE UNIQUE INDEX "course_sessions_course_id_session_id_key" ON "course_sessions"("course_id", "session_id");
CREATE UNIQUE INDEX "course_sessions_course_id_order_index_key" ON "course_sessions"("course_id", "order_index");
CREATE INDEX "course_sessions_session_id_idx" ON "course_sessions"("session_id");
CREATE INDEX "course_sessions_course_id_retired_at_order_index_idx" ON "course_sessions"("course_id", "retired_at", "order_index");

CREATE UNIQUE INDEX "batches_code_key" ON "batches"("code");
CREATE UNIQUE INDEX "batches_id_course_id_key" ON "batches"("id", "course_id");
CREATE INDEX "batches_course_id_status_start_date_idx" ON "batches"("course_id", "status", "start_date");

CREATE UNIQUE INDEX "enrollments_id_course_id_key" ON "enrollments"("id", "course_id");
CREATE UNIQUE INDEX "enrollments_user_id_batch_id_key" ON "enrollments"("user_id", "batch_id");
CREATE UNIQUE INDEX "enrollments_user_id_course_id_self_key" ON "enrollments"("user_id", "course_id") WHERE "batch_id" IS NULL;
CREATE INDEX "enrollments_user_id_status_idx" ON "enrollments"("user_id", "status");
CREATE INDEX "enrollments_course_id_status_idx" ON "enrollments"("course_id", "status");
CREATE INDEX "enrollments_batch_id_status_idx" ON "enrollments"("batch_id", "status");
CREATE INDEX "enrollments_enrolled_by_user_id_idx" ON "enrollments"("enrolled_by_user_id");

CREATE UNIQUE INDEX "batch_sessions_batch_id_course_session_id_key" ON "batch_sessions"("batch_id", "course_session_id");
CREATE UNIQUE INDEX "batch_sessions_batch_id_order_index_key" ON "batch_sessions"("batch_id", "order_index");
CREATE INDEX "batch_sessions_course_session_id_idx" ON "batch_sessions"("course_session_id");
CREATE INDEX "batch_sessions_batch_id_is_released_available_at_idx" ON "batch_sessions"("batch_id", "is_released", "available_at");
CREATE INDEX "batch_sessions_course_id_idx" ON "batch_sessions"("course_id");

CREATE UNIQUE INDEX "session_completions_course_session_id_enrollment_id_key" ON "session_completions"("course_session_id", "enrollment_id");
CREATE INDEX "session_completions_enrollment_id_idx" ON "session_completions"("enrollment_id");
CREATE INDEX "session_completions_course_session_id_idx" ON "session_completions"("course_session_id");
CREATE INDEX "session_completions_course_id_idx" ON "session_completions"("course_id");

CREATE UNIQUE INDEX "certificates_enrollment_id_key" ON "certificates"("enrollment_id");
CREATE UNIQUE INDEX "certificates_certificate_code_key" ON "certificates"("certificate_code");
CREATE INDEX "certificates_status_issued_date_idx" ON "certificates"("status", "issued_date");

CREATE INDEX "student_projects_course_id_status_is_public_idx" ON "student_projects"("course_id", "status", "is_public");
CREATE INDEX "student_projects_user_id_created_at_idx" ON "student_projects"("user_id", "created_at" DESC);
CREATE INDEX "student_projects_like_count_created_at_idx" ON "student_projects"("like_count" DESC, "created_at" DESC);

-- AddForeignKey
ALTER TABLE "course_sessions" ADD CONSTRAINT "course_sessions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_sessions" ADD CONSTRAINT "course_sessions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "batches" ADD CONSTRAINT "batches_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_enrolled_by_user_id_fkey" FOREIGN KEY ("enrolled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_batch_id_course_id_fkey" FOREIGN KEY ("batch_id", "course_id") REFERENCES "batches"("id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "batch_sessions" ADD CONSTRAINT "batch_sessions_batch_id_course_id_fkey" FOREIGN KEY ("batch_id", "course_id") REFERENCES "batches"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "batch_sessions" ADD CONSTRAINT "batch_sessions_course_session_id_course_id_fkey" FOREIGN KEY ("course_session_id", "course_id") REFERENCES "course_sessions"("id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "session_completions" ADD CONSTRAINT "session_completions_course_session_id_course_id_fkey" FOREIGN KEY ("course_session_id", "course_id") REFERENCES "course_sessions"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_completions" ADD CONSTRAINT "session_completions_enrollment_id_course_id_fkey" FOREIGN KEY ("enrollment_id", "course_id") REFERENCES "enrollments"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "student_projects" ADD CONSTRAINT "student_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_projects" ADD CONSTRAINT "student_projects_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_projects" ADD CONSTRAINT "student_projects_enrollment_id_course_id_fkey" FOREIGN KEY ("enrollment_id", "course_id") REFERENCES "enrollments"("id", "course_id") ON DELETE CASCADE ON UPDATE CASCADE;

