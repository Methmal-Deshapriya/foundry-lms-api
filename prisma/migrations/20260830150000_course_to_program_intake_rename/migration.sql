/*
  CourseGroup -> Course, Course -> Intake.

  This is an intentionally breaking development migration, matching the
  established convention for this pre-production schema (see the
  2026-08-07 and 2026-08-12 migrations): the affected tables are dropped and
  recreated rather than carefully altered/backfilled. The system has not gone
  to production and the only real rows affected are 26 development catalog
  entries (0 enrollments, 0 payments) — not worth preserving against the size
  of this restructuring. See
  foundry_lms_docs/2026-08-30_course_to_program_intake_model_rename_plan.md
  for the full reasoning.
*/

-- ============================================================================
-- Drop dependent triggers, functions, and the tables being restructured
-- ============================================================================

DROP TRIGGER IF EXISTS "certificates_course_group_policy_guard" ON "certificates";
DROP TRIGGER IF EXISTS "course_groups_certificate_policy_immutable" ON "course_groups";
DROP TRIGGER IF EXISTS "courses_certificate_policy_immutable" ON "courses";
DROP TRIGGER IF EXISTS "courses_learning_service_policy_trigger" ON "courses";
DROP TRIGGER IF EXISTS "enrollments_learning_service_policy_trigger" ON "enrollments";

DROP FUNCTION IF EXISTS validate_certificate_course_group_policy();
DROP FUNCTION IF EXISTS prevent_course_group_certificate_policy_change();
DROP FUNCTION IF EXISTS prevent_course_certificate_policy_change();
DROP FUNCTION IF EXISTS validate_course_learning_service_policy();
DROP FUNCTION IF EXISTS validate_enrollment_learning_service_policy();

DROP TABLE IF EXISTS
  "student_projects",
  "certificates",
  "payments",
  "session_completions",
  "course_sessions",
  "enrollments",
  "courses",
  "course_groups"
CASCADE;

DROP TYPE IF EXISTS "CourseStatus";
DROP TYPE IF EXISTS "CourseEnrollmentStatus"; -- superseded: old COMING_SOON/OPEN/CLOSED version, dead since access_type was dropped

-- ============================================================================
-- New/renamed enums
-- ============================================================================

CREATE TYPE "CourseEnrollmentStatus" AS ENUM ('COMING_SOON', 'OPEN', 'REOPENING_SOON');
CREATE TYPE "IntakeStatus" AS ENUM ('DRAFT', 'OPEN_ACTIVE', 'CLOSED_ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED');
CREATE TYPE "EnrollmentRequestStatus" AS ENUM ('PENDING', 'CONTACTED', 'ENROLLED', 'DECLINED');

-- ============================================================================
-- Course: the real-world program (formerly CourseGroup)
-- ============================================================================

CREATE TABLE "courses" (
    "id"                  TEXT NOT NULL,
    "category_id"         TEXT NOT NULL,
    "slug"                TEXT NOT NULL,
    "title"               TEXT NOT NULL,
    "summary"             TEXT NOT NULL,
    "description"         TEXT NOT NULL,
    "level"               "CourseLevel" NOT NULL,
    "duration_value"      INTEGER,
    "duration_unit"       "DurationUnit",
    "highlights"          TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills"              TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prerequisites"       TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnail_url"       TEXT,
    "sort_order"          INTEGER NOT NULL DEFAULT 0,
    "price"               DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency"            TEXT NOT NULL DEFAULT 'LKR',
    "intake_code_prefix"  TEXT NOT NULL,
    "certificate_enabled" BOOLEAN NOT NULL,
    "discount_amount"     DECIMAL(12,2) NOT NULL DEFAULT 0,
    "enrollment_status"   "CourseEnrollmentStatus" NOT NULL DEFAULT 'COMING_SOON',
    "archived_at"         TIMESTAMP(3),
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "courses_currency_lkr_check" CHECK ("currency" = 'LKR'),
    CONSTRAINT "courses_duration_check" CHECK (
      ("duration_value" IS NULL AND "duration_unit" IS NULL)
      OR ("duration_value" > 0 AND "duration_unit" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "courses_intake_code_prefix_key" ON "courses"("intake_code_prefix");
CREATE UNIQUE INDEX "courses_id_category_id_key" ON "courses"("id", "category_id");
CREATE UNIQUE INDEX "courses_category_id_slug_key" ON "courses"("category_id", "slug");
CREATE INDEX "courses_category_id_archived_at_title_idx" ON "courses"("category_id", "archived_at", "title");
CREATE INDEX "courses_category_id_enrollment_status_sort_order_idx" ON "courses"("category_id", "enrollment_status", "sort_order");

ALTER TABLE "courses" ADD CONSTRAINT "courses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Intake: one scheduled, enrollable run of a Course (formerly Course)
-- ============================================================================

CREATE TABLE "intakes" (
    "id"                TEXT NOT NULL,
    "course_id"         TEXT NOT NULL,
    "category_id"       TEXT NOT NULL,
    "intake_key"        TEXT NOT NULL,
    "code"              TEXT NOT NULL,
    "start_date"        DATE,
    "expected_end_date" DATE,
    "timezone"          TEXT NOT NULL DEFAULT 'Asia/Colombo',
    "capacity"          INTEGER,
    "status"            "IntakeStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intakes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "intakes_capacity_check" CHECK ("capacity" IS NULL OR "capacity" > 0),
    CONSTRAINT "intakes_timezone_check" CHECK (char_length(btrim("timezone")) > 0)
);

CREATE UNIQUE INDEX "intakes_code_key" ON "intakes"("code");
CREATE UNIQUE INDEX "intakes_course_id_intake_key_key" ON "intakes"("course_id", "intake_key");
CREATE UNIQUE INDEX "intakes_id_course_id_key" ON "intakes"("id", "course_id");
CREATE INDEX "intakes_course_id_status_start_date_idx" ON "intakes"("course_id", "status", "start_date");
CREATE INDEX "intakes_category_id_status_idx" ON "intakes"("category_id", "status");

ALTER TABLE "intakes" ADD CONSTRAINT "intakes_course_id_category_id_fkey" FOREIGN KEY ("course_id", "category_id") REFERENCES "courses"("id", "category_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Enrollment: now carries both the program (courseId) and the specific run (intakeId)
-- ============================================================================

CREATE TABLE "enrollments" (
    "id"                          TEXT NOT NULL,
    "user_id"                     TEXT NOT NULL,
    "course_id"                   TEXT NOT NULL,
    "intake_id"                   TEXT NOT NULL,
    "source"                      "EnrollmentSource" NOT NULL,
    "enrolled_by_user_id"         TEXT,
    "status"                      "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "payment_status"              "PaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "payment_completed_at"        TIMESTAMP(3),
    "external_payment_reference"  TEXT,
    "payment_note"                TEXT,
    "completed_at"                TIMESTAMP(3),
    "created_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "enrollments_completed_at_check" CHECK (
      ("status" = 'COMPLETED' AND "completed_at" IS NOT NULL)
      OR ("status" <> 'COMPLETED' AND "completed_at" IS NULL)
    ),
    CONSTRAINT "enrollments_payment_completed_at_check" CHECK (
      ("payment_status" = 'COMPLETED' AND "payment_completed_at" IS NOT NULL)
      OR ("payment_status" <> 'COMPLETED' AND "payment_completed_at" IS NULL)
    ),
    CONSTRAINT "enrollments_payment_mode_check" CHECK (
      ("source" = 'SELF' AND "payment_status" = 'NOT_REQUIRED')
      OR ("source" = 'ADMIN' AND "payment_status" <> 'NOT_REQUIRED')
    )
);

CREATE UNIQUE INDEX "enrollments_id_intake_id_key" ON "enrollments"("id", "intake_id");
CREATE UNIQUE INDEX "enrollments_user_id_intake_id_key" ON "enrollments"("user_id", "intake_id");
CREATE INDEX "enrollments_course_id_status_idx" ON "enrollments"("course_id", "status");
CREATE INDEX "enrollments_intake_id_status_idx" ON "enrollments"("intake_id", "status");
CREATE INDEX "enrollments_intake_id_created_at_id_idx" ON "enrollments"("intake_id", "created_at" DESC, "id" DESC);
CREATE INDEX "enrollments_enrolled_by_user_id_idx" ON "enrollments"("enrolled_by_user_id");

ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_enrolled_by_user_id_fkey" FOREIGN KEY ("enrolled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_intake_id_course_id_fkey" FOREIGN KEY ("intake_id", "course_id") REFERENCES "intakes"("id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- CourseSession: intake-scoped curriculum entry (session release visibility
-- belongs to the intake, not the course — see the rename plan §6)
-- ============================================================================

CREATE TABLE "course_sessions" (
    "id"                     TEXT NOT NULL,
    "intake_id"              TEXT NOT NULL,
    "session_id"             TEXT NOT NULL,
    "order_index"            INTEGER,
    "delivery_status"        "CourseSessionDeliveryStatus" NOT NULL DEFAULT 'UNRELEASED',
    "available_at"           TIMESTAMP(3),
    "first_released_at"      TIMESTAMP(3),
    "retired_at"             TIMESTAMP(3),
    "historical_order_index" INTEGER,
    "created_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "course_sessions_lifecycle_check" CHECK (
      ("retired_at" IS NULL AND "order_index" IS NOT NULL AND "order_index" >= 0)
      OR ("retired_at" IS NOT NULL AND "order_index" IS NULL)
    ),
    CONSTRAINT "course_sessions_delivery_state_check" CHECK (
      ("delivery_status" = ANY (ARRAY['UNRELEASED'::"CourseSessionDeliveryStatus", 'WITHDRAWN'::"CourseSessionDeliveryStatus"]) AND "available_at" IS NULL)
      OR ("delivery_status" = 'SCHEDULED' AND "available_at" IS NOT NULL)
      OR ("delivery_status" = 'RELEASED' AND "available_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "course_sessions_id_intake_id_key" ON "course_sessions"("id", "intake_id");
CREATE UNIQUE INDEX "course_sessions_intake_id_session_id_key" ON "course_sessions"("intake_id", "session_id");
CREATE UNIQUE INDEX "course_sessions_intake_id_order_index_key" ON "course_sessions"("intake_id", "order_index");
CREATE INDEX "course_sessions_session_id_idx" ON "course_sessions"("session_id");
CREATE INDEX "course_sessions_intake_id_retired_at_order_index_idx" ON "course_sessions"("intake_id", "retired_at", "order_index");
CREATE INDEX "course_sessions_intake_id_delivery_status_available_at_idx" ON "course_sessions"("intake_id", "delivery_status", "available_at");

ALTER TABLE "course_sessions" ADD CONSTRAINT "course_sessions_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "intakes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "course_sessions" ADD CONSTRAINT "course_sessions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- SessionCompletion (intake-scoped, single-key — see rename plan §6)
-- ============================================================================

CREATE TABLE "session_completions" (
    "id"                TEXT NOT NULL,
    "course_session_id" TEXT NOT NULL,
    "enrollment_id"     TEXT NOT NULL,
    "intake_id"         TEXT NOT NULL,
    "completed_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_completions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "session_completions_course_session_id_enrollment_id_key" ON "session_completions"("course_session_id", "enrollment_id");
CREATE INDEX "session_completions_enrollment_id_idx" ON "session_completions"("enrollment_id");
CREATE INDEX "session_completions_course_session_id_idx" ON "session_completions"("course_session_id");
CREATE INDEX "session_completions_intake_id_idx" ON "session_completions"("intake_id");

ALTER TABLE "session_completions" ADD CONSTRAINT "session_completions_course_session_id_intake_id_fkey" FOREIGN KEY ("course_session_id", "intake_id") REFERENCES "course_sessions"("id", "intake_id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_completions" ADD CONSTRAINT "session_completions_enrollment_id_intake_id_fkey" FOREIGN KEY ("enrollment_id", "intake_id") REFERENCES "enrollments"("id", "intake_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- Payment: now also carries intakeId, so the ledger can be managed intake-wise
-- ============================================================================

CREATE TABLE "payments" (
    "id"                   TEXT NOT NULL,
    "enrollment_id"        TEXT NOT NULL,
    "course_id"            TEXT NOT NULL,
    "intake_id"            TEXT NOT NULL,
    "amount"               DECIMAL(12,2) NOT NULL,
    "discount_amount"      DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency"             TEXT NOT NULL DEFAULT 'LKR',
    "type"                 "PaymentType" NOT NULL,
    "external_reference"   TEXT,
    "note"                 TEXT,
    "recorded_by_user_id"  TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payments_course_id_created_at_idx" ON "payments"("course_id", "created_at");
CREATE INDEX "payments_intake_id_created_at_idx" ON "payments"("intake_id", "created_at");
CREATE INDEX "payments_enrollment_id_created_at_idx" ON "payments"("enrollment_id", "created_at");

ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_intake_id_course_id_fkey" FOREIGN KEY ("intake_id", "course_id") REFERENCES "intakes"("id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Certificate (unchanged in shape — enrollment_id still the only FK)
-- ============================================================================

CREATE TABLE "certificates" (
    "id"                TEXT NOT NULL,
    "enrollment_id"     TEXT NOT NULL,
    "certificate_code"  TEXT NOT NULL,
    "student_name"      TEXT NOT NULL,
    "course_name"       TEXT NOT NULL,
    "description"       TEXT,
    "issued_date"       TIMESTAMP(3) NOT NULL,
    "status"            "CertificateStatus" NOT NULL DEFAULT 'ISSUED',
    "revoked_at"        TIMESTAMP(3),
    "revoked_by"        TEXT,
    "revocation_reason" TEXT,
    "certificate_data"  JSONB NOT NULL,
    "snapshot_url"      TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "certificates_revocation_state_check" CHECK (
      ("status" = 'ISSUED' AND "revoked_at" IS NULL AND "revoked_by" IS NULL AND "revocation_reason" IS NULL)
      OR ("status" = 'REVOKED' AND "revoked_at" IS NOT NULL AND "revoked_by" IS NOT NULL AND char_length(btrim("revocation_reason")) > 0)
    )
);

CREATE UNIQUE INDEX "certificates_certificate_code_key" ON "certificates"("certificate_code");
CREATE INDEX "certificates_enrollment_id_status_issued_date_idx" ON "certificates"("enrollment_id", "status", "issued_date" DESC);
CREATE INDEX "certificates_status_issued_date_idx" ON "certificates"("status", "issued_date");
CREATE INDEX "certificates_created_at_id_idx" ON "certificates"("created_at" DESC, "id" DESC);
CREATE INDEX "certificates_code_trgm_idx" ON "certificates" USING GIN ("certificate_code" gin_trgm_ops);
CREATE INDEX "certificates_student_name_trgm_idx" ON "certificates" USING GIN ("student_name" gin_trgm_ops);
CREATE INDEX "certificates_course_name_trgm_idx" ON "certificates" USING GIN ("course_name" gin_trgm_ops);

ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- StudentProject (intake-scoped, single-key — see rename plan §6)
-- ============================================================================

CREATE TABLE "student_projects" (
    "id"             TEXT NOT NULL,
    "user_id"        TEXT NOT NULL,
    "intake_id"      TEXT NOT NULL,
    "enrollment_id"  TEXT NOT NULL,
    "title"          TEXT NOT NULL,
    "description"    TEXT,
    "thumbnail_url"  TEXT,
    "project_url"    TEXT,
    "github_url"     TEXT,
    "demo_url"       TEXT,
    "technologies"   JSONB NOT NULL DEFAULT '[]',
    "status"         "ProjectStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by"    TEXT,
    "reviewed_at"    TIMESTAMP(3),
    "admin_feedback" TEXT,
    "is_public"      BOOLEAN NOT NULL DEFAULT false,
    "display_order"  INTEGER NOT NULL DEFAULT 0,
    "like_count"     INTEGER NOT NULL DEFAULT 0,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_projects_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "student_projects_intake_id_status_is_public_idx" ON "student_projects"("intake_id", "status", "is_public");
CREATE INDEX "student_projects_user_id_created_at_idx" ON "student_projects"("user_id", "created_at" DESC);
CREATE INDEX "student_projects_enrollment_id_idx" ON "student_projects"("enrollment_id");
CREATE INDEX "student_projects_like_count_created_at_idx" ON "student_projects"("like_count" DESC, "created_at" DESC);

ALTER TABLE "student_projects" ADD CONSTRAINT "student_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_projects" ADD CONSTRAINT "student_projects_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "intakes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_projects" ADD CONSTRAINT "student_projects_enrollment_id_intake_id_fkey" FOREIGN KEY ("enrollment_id", "intake_id") REFERENCES "enrollments"("id", "intake_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================================================
-- EnrollmentRequest (new — the paid-enrollment request flow, rename plan §8a)
-- ============================================================================

CREATE TABLE "enrollment_requests" (
    "id"                    TEXT NOT NULL,
    "course_id"             TEXT NOT NULL,
    "intake_id"             TEXT NOT NULL,
    "student_user_id"       TEXT NOT NULL,
    "contact_phone"         TEXT NOT NULL,
    "status"                "EnrollmentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "contacted_at"          TIMESTAMP(3),
    "contacted_by_user_id"  TEXT,
    "enrollment_id"         TEXT,
    "created_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "enrollment_requests_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "enrollment_requests_enrollment_id_key" ON "enrollment_requests"("enrollment_id");
CREATE INDEX "enrollment_requests_intake_id_status_idx" ON "enrollment_requests"("intake_id", "status");
CREATE INDEX "enrollment_requests_course_id_status_idx" ON "enrollment_requests"("course_id", "status");
CREATE INDEX "enrollment_requests_student_user_id_idx" ON "enrollment_requests"("student_user_id");

ALTER TABLE "enrollment_requests" ADD CONSTRAINT "enrollment_requests_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollment_requests" ADD CONSTRAINT "enrollment_requests_intake_id_course_id_fkey" FOREIGN KEY ("intake_id", "course_id") REFERENCES "intakes"("id", "course_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollment_requests" ADD CONSTRAINT "enrollment_requests_student_user_id_fkey" FOREIGN KEY ("student_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollment_requests" ADD CONSTRAINT "enrollment_requests_contacted_by_user_id_fkey" FOREIGN KEY ("contacted_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "enrollment_requests" ADD CONSTRAINT "enrollment_requests_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ============================================================================
-- Triggers: certificate-policy immutability, moved from CourseGroup to Course
-- ============================================================================

CREATE OR REPLACE FUNCTION prevent_course_certificate_policy_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.certificate_enabled IS DISTINCT FROM OLD.certificate_enabled THEN
    RAISE EXCEPTION 'Course certificate policy is immutable after creation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER courses_certificate_policy_immutable
BEFORE UPDATE OF certificate_enabled ON courses
FOR EACH ROW
EXECUTE FUNCTION prevent_course_certificate_policy_change();

-- ============================================================================
-- Trigger: FREE/PAID pricing policy, now checked at Course level (price moved
-- off the per-intake table, so this can no longer live on intake insert/update)
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_course_pricing_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  service_access "LearningAccessType";
BEGIN
  SELECT service.access_type
    INTO service_access
  FROM categories category
  JOIN learning_services service ON service.id = category.service_id
  WHERE category.id = NEW.category_id;

  IF service_access IS NULL THEN
    RAISE EXCEPTION 'Course Category and LearningService relationship is invalid.'
      USING ERRCODE = '23503';
  END IF;

  IF service_access = 'FREE' AND NEW.price <> 0 THEN
    RAISE EXCEPTION 'Free LearningService Courses must have zero price.'
      USING ERRCODE = '23514';
  END IF;
  IF service_access = 'PAID' AND NEW.price <= 0 THEN
    RAISE EXCEPTION 'Paid LearningService Courses must have a positive price.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER courses_pricing_policy_trigger
BEFORE INSERT OR UPDATE OF "price", "category_id"
ON "courses"
FOR EACH ROW EXECUTE FUNCTION validate_course_pricing_policy();

-- ============================================================================
-- Trigger: intake lifecycle policy (formerly the per-course version). The
-- price check moved out (see above); "only one Intake per Evergreen Course"
-- now self-joins the intakes table instead of the old courses table.
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_intake_learning_service_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  service_id TEXT;
  service_mode "LearningCourseMode";
  service_status "LearningServiceStatus";
BEGIN
  SELECT service.id, service.course_mode, service.status
    INTO service_id, service_mode, service_status
  FROM courses course
  JOIN categories category ON category.id = course.category_id
  JOIN learning_services service ON service.id = category.service_id
  WHERE course.id = NEW.course_id
    AND category.id = NEW.category_id;

  IF service_id IS NULL THEN
    RAISE EXCEPTION 'Course, Category, and LearningService relationship is invalid.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('learning-service:' || service_id));
  PERFORM pg_advisory_xact_lock(hashtext('course:' || NEW.course_id));

  IF service_mode = 'SEASONAL' THEN
    IF NEW.start_date IS NULL OR NEW.expected_end_date IS NULL
       OR NEW.expected_end_date <= NEW.start_date THEN
      RAISE EXCEPTION 'Seasonal Intakes require valid start and expected-end dates.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.start_date IS NOT NULL OR NEW.expected_end_date IS NOT NULL THEN
      RAISE EXCEPTION 'Evergreen Intakes cannot have intake dates.'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM intakes existing
      WHERE existing.course_id = NEW.course_id
        AND existing.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'An Evergreen LearningService Course can have only one Intake.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF NEW.status = 'OPEN_ACTIVE' AND service_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Only an Active LearningService can expose an Open-Active Intake.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER intakes_learning_service_policy_trigger
BEFORE INSERT OR UPDATE OF "course_id", "category_id", "start_date", "expected_end_date", "status"
ON "intakes"
FOR EACH ROW EXECUTE FUNCTION validate_intake_learning_service_policy();

-- ============================================================================
-- Trigger: enrollment learning-service policy. Body is unchanged from before
-- the rename — enrollments.course_id now points directly at the new `courses`
-- table (the program), and a course's category never differs from its
-- intakes', so the same join still resolves the correct LearningService.
-- intake_id is added to the watched-column list defensively.
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_enrollment_learning_service_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  service_id TEXT;
  enrollment_mode "LearningEnrollmentMode";
  payment_requirement "LearningPaymentRequirement";
BEGIN
  SELECT service.id, service.enrollment_mode, service.payment_requirement
    INTO service_id, enrollment_mode, payment_requirement
  FROM courses course
  JOIN categories category ON category.id = course.category_id
  JOIN learning_services service ON service.id = category.service_id
  WHERE course.id = NEW.course_id;

  IF service_id IS NULL THEN
    RAISE EXCEPTION 'Enrollment Course has no LearningService policy.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('learning-service:' || service_id));

  IF enrollment_mode = 'ADMIN'
     AND (NEW.source <> 'ADMIN' OR NEW.enrolled_by_user_id IS NULL) THEN
    RAISE EXCEPTION 'This LearningService requires administrator enrollment.'
      USING ERRCODE = '23514';
  END IF;
  IF enrollment_mode = 'SELF'
     AND (NEW.source <> 'SELF' OR NEW.enrolled_by_user_id IS NOT NULL) THEN
    RAISE EXCEPTION 'This LearningService requires self enrollment.'
      USING ERRCODE = '23514';
  END IF;
  IF payment_requirement = 'REQUIRED' AND NEW.payment_status = 'NOT_REQUIRED' THEN
    RAISE EXCEPTION 'This LearningService requires a payment state.'
      USING ERRCODE = '23514';
  END IF;
  IF payment_requirement = 'NOT_REQUIRED' AND NEW.payment_status <> 'NOT_REQUIRED' THEN
    RAISE EXCEPTION 'This LearningService does not accept payment states.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER enrollments_learning_service_policy_trigger
BEFORE INSERT OR UPDATE OF "course_id", "intake_id", "source", "enrolled_by_user_id", "payment_status"
ON "enrollments"
FOR EACH ROW EXECUTE FUNCTION validate_enrollment_learning_service_policy();

-- ============================================================================
-- Trigger: certificate <-> course certificate-policy guard. Simplified: an
-- enrollment's course_id now points directly at the entity holding
-- certificate_enabled, so the old course -> course_group hop is gone.
-- ============================================================================

CREATE OR REPLACE FUNCTION validate_certificate_course_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  certificate_support_enabled BOOLEAN;
BEGIN
  SELECT course.certificate_enabled
  INTO certificate_support_enabled
  FROM enrollments AS enrollment
  JOIN courses AS course ON course.id = enrollment.course_id
  WHERE enrollment.id = NEW.enrollment_id;

  IF certificate_support_enabled IS NULL THEN
    RAISE EXCEPTION 'Certificate enrollment does not resolve to a course.'
      USING ERRCODE = '23503';
  END IF;

  IF certificate_support_enabled IS FALSE THEN
    RAISE EXCEPTION 'Certificates are disabled for this course.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER certificates_course_policy_guard
BEFORE INSERT OR UPDATE OF enrollment_id ON certificates
FOR EACH ROW
EXECUTE FUNCTION validate_certificate_course_policy();
