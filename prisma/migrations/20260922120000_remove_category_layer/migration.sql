/*
  Remove the Category layer entirely: LearningService -> Category -> Course -> Intake
  becomes LearningService -> Course -> Intake.

  Only "courses" and "intakes" carry a direct FK to "categories" — nothing else in
  the schema does (Enrollment/Payment/Certificate/StudentProject/EnrollmentRequest
  only reach it transitively through course/intake). Live data at the time of this
  migration: 3 services, 12 categories (only 1 actually in use), 1 course, 1 intake,
  1 enrollment, 1 payment, 1 certificate — small enough that this is a plain
  backfill-then-drop, not a large data migration, unlike the full drop/recreate used
  by the 20260830150000 rename.

  Course gains its own "status" (Draft/Published/Archived), taking over exactly what
  Category's status used to gate for public visibility. "audience_label"/
  "visual_key"/"badge_label" are dropped without replacement (course cards use one
  fixed icon per service on the client, and the existing enrollment-status pill
  already covers what badge_label was doing).

  See foundry_lms_docs/2026-09-22_category_layer_removal_plan.md for the full
  reasoning.
*/

-- ============================================================================
-- 1. Add the new columns (nullable for now, so existing rows can be backfilled
--    before either becomes required)
-- ============================================================================

ALTER TABLE "courses" ADD COLUMN "service_id" TEXT;
ALTER TABLE "courses" ADD COLUMN "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "intakes" ADD COLUMN "service_id" TEXT;

-- ============================================================================
-- 2. Backfill from categories
-- ============================================================================

UPDATE "courses" c
SET "service_id" = cat."service_id",
    "status" = cat."status"
FROM "categories" cat
WHERE c."category_id" = cat."id";

UPDATE "intakes" i
SET "service_id" = cat."service_id"
FROM "categories" cat
WHERE i."category_id" = cat."id";

-- ============================================================================
-- 3. Now that every row has a value, make service_id required
-- ============================================================================

ALTER TABLE "courses" ALTER COLUMN "service_id" SET NOT NULL;
ALTER TABLE "intakes" ALTER COLUMN "service_id" SET NOT NULL;

-- ============================================================================
-- 4. Two triggers are column-specific (BEFORE ... OF "category_id", ...) and
--    Postgres tracks a hard dependency between such a trigger and that exact
--    column — they must be dropped before category_id can be dropped, not
--    after. They're recreated against service_id in step 7.
-- ============================================================================

DROP TRIGGER IF EXISTS "courses_pricing_policy_trigger" ON "courses";
DROP TRIGGER IF EXISTS "intakes_learning_service_policy_trigger" ON "intakes";

-- ============================================================================
-- 5. Drop the old category_id constraints, indexes, and columns
-- ============================================================================

ALTER TABLE "intakes" DROP CONSTRAINT "intakes_course_id_category_id_fkey";
ALTER TABLE "intakes" DROP CONSTRAINT "intakes_category_id_fkey";
DROP INDEX "intakes_category_id_status_idx";

ALTER TABLE "courses" DROP CONSTRAINT "courses_category_id_fkey";
DROP INDEX "courses_id_category_id_key";
DROP INDEX "courses_category_id_slug_key";
DROP INDEX "courses_category_id_archived_at_title_idx";
DROP INDEX "courses_category_id_enrollment_status_sort_order_idx";

ALTER TABLE "intakes" DROP COLUMN "category_id";
ALTER TABLE "courses" DROP COLUMN "category_id";

-- ============================================================================
-- 6. Add the new service_id constraints and indexes
-- ============================================================================

ALTER TABLE "courses" ADD CONSTRAINT "courses_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "learning_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE UNIQUE INDEX "courses_id_service_id_key" ON "courses"("id", "service_id");
CREATE UNIQUE INDEX "courses_service_id_slug_key" ON "courses"("service_id", "slug");
CREATE INDEX "courses_service_id_archived_at_title_idx" ON "courses"("service_id", "archived_at", "title");
CREATE INDEX "courses_service_id_enrollment_status_sort_order_idx" ON "courses"("service_id", "enrollment_status", "sort_order");
CREATE INDEX "courses_service_id_status_sort_order_idx" ON "courses"("service_id", "status", "sort_order");

ALTER TABLE "intakes" ADD CONSTRAINT "intakes_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "learning_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "intakes" ADD CONSTRAINT "intakes_course_id_service_id_fkey" FOREIGN KEY ("course_id", "service_id") REFERENCES "courses"("id", "service_id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "intakes_service_id_status_idx" ON "intakes"("service_id", "status");

-- ============================================================================
-- 7. Drop categories entirely. Its own self-immutability trigger goes with the
--    table automatically; the function object behind it does not and needs an
--    explicit drop.
-- ============================================================================

DROP TABLE "categories";
DROP FUNCTION IF EXISTS prevent_category_service_change();

-- ============================================================================
-- 8. Rewrite the 4 surviving trigger functions that joined through categories
--    (found live in the database — these exist only as migration SQL, never
--    represented in schema.prisma, so they're easy to miss). The two that were
--    dropped in step 4 are recreated here against service_id.
-- ============================================================================

-- courses_pricing_policy_trigger: FREE/PAID pricing check, now reads service_id directly
CREATE OR REPLACE FUNCTION validate_course_pricing_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  service_access "LearningAccessType";
BEGIN
  SELECT service.access_type
    INTO service_access
  FROM learning_services service
  WHERE service.id = NEW.service_id;

  IF service_access IS NULL THEN
    RAISE EXCEPTION 'Course LearningService relationship is invalid.'
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

DROP TRIGGER IF EXISTS "courses_pricing_policy_trigger" ON "courses";
CREATE TRIGGER courses_pricing_policy_trigger
BEFORE INSERT OR UPDATE OF "price", "service_id"
ON "courses"
FOR EACH ROW EXECUTE FUNCTION validate_course_pricing_policy();

-- intakes_learning_service_policy_trigger: drop the categories hop between courses and learning_services
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
  JOIN learning_services service ON service.id = course.service_id
  WHERE course.id = NEW.course_id
    AND course.service_id = NEW.service_id;

  IF service_id IS NULL THEN
    RAISE EXCEPTION 'Course and LearningService relationship is invalid.'
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

DROP TRIGGER IF EXISTS "intakes_learning_service_policy_trigger" ON "intakes";
CREATE TRIGGER intakes_learning_service_policy_trigger
BEFORE INSERT OR UPDATE OF "course_id", "service_id", "start_date", "expected_end_date", "status"
ON "intakes"
FOR EACH ROW EXECUTE FUNCTION validate_intake_learning_service_policy();

-- enrollments_learning_service_policy_trigger: drop the categories hop
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
  JOIN learning_services service ON service.id = course.service_id
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

DROP TRIGGER IF EXISTS "enrollments_learning_service_policy_trigger" ON "enrollments";
CREATE TRIGGER enrollments_learning_service_policy_trigger
BEFORE INSERT OR UPDATE OF "course_id", "intake_id", "source", "enrolled_by_user_id", "payment_status"
ON "enrollments"
FOR EACH ROW EXECUTE FUNCTION validate_enrollment_learning_service_policy();

-- learning_services_policy_immutable_trigger: "immutable after its first Category"
-- becomes "...first Course"; the active-intake check now reads intakes.service_id
-- directly instead of joining through categories (trigger definition itself is
-- unchanged — BEFORE UPDATE ON learning_services, no watched-column list — so only
-- the function body needs replacing).
CREATE OR REPLACE FUNCTION prevent_used_learning_service_policy_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('learning-service:' || OLD.id));

  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'LearningService key is immutable after creation.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM courses WHERE service_id = OLD.id)
     AND (
       NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.access_type IS DISTINCT FROM OLD.access_type
       OR NEW.course_mode IS DISTINCT FROM OLD.course_mode
       OR NEW.enrollment_mode IS DISTINCT FROM OLD.enrollment_mode
       OR NEW.payment_requirement IS DISTINCT FROM OLD.payment_requirement
     ) THEN
    RAISE EXCEPTION 'LearningService identity and policy are immutable after its first Course.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'ARCHIVED' AND OLD.status <> 'ARCHIVED'
     AND EXISTS (
       SELECT 1
       FROM intakes intake
       WHERE intake.service_id = OLD.id
         AND intake.status IN ('OPEN_ACTIVE', 'CLOSED_ACTIVE')
     ) THEN
    RAISE EXCEPTION 'Complete or cancel every active Intake before archiving this LearningService.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
