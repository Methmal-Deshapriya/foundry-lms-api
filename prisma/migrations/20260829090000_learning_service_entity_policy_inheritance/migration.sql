-- LearningService becomes the database source of truth for access, course,
-- enrollment, and payment policy. Existing catalog data is preserved.

CREATE TYPE "LearningAccessType" AS ENUM ('FREE', 'PAID');
CREATE TYPE "LearningCourseMode" AS ENUM ('SEASONAL', 'EVERGREEN');
CREATE TYPE "LearningEnrollmentMode" AS ENUM ('ADMIN', 'SELF');
CREATE TYPE "LearningPaymentRequirement" AS ENUM ('REQUIRED', 'NOT_REQUIRED');
CREATE TYPE "LearningServiceStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

CREATE TABLE "learning_services" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "access_type" "LearningAccessType" NOT NULL,
  "course_mode" "LearningCourseMode" NOT NULL,
  "enrollment_mode" "LearningEnrollmentMode" NOT NULL,
  "payment_requirement" "LearningPaymentRequirement" NOT NULL,
  "status" "LearningServiceStatus" NOT NULL DEFAULT 'DRAFT',
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "learning_services_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "learning_services_supported_policy_check" CHECK (
    (
      "access_type" = 'PAID'
      AND "course_mode" = 'SEASONAL'
      AND "enrollment_mode" = 'ADMIN'
      AND "payment_requirement" = 'REQUIRED'
    )
    OR
    (
      "access_type" = 'FREE'
      AND "course_mode" = 'EVERGREEN'
      AND "enrollment_mode" = 'SELF'
      AND "payment_requirement" = 'NOT_REQUIRED'
    )
  ),
  CONSTRAINT "learning_services_key_check" CHECK ("key" ~ '^[A-Z0-9]+(?:_[A-Z0-9]+)*$'),
  CONSTRAINT "learning_services_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  CONSTRAINT "learning_services_title_check" CHECK (char_length(btrim("title")) >= 3),
  CONSTRAINT "learning_services_description_check" CHECK (char_length(btrim("description")) >= 10),
  CONSTRAINT "learning_services_sort_order_check" CHECK ("sort_order" >= 0)
);

CREATE UNIQUE INDEX "learning_services_key_key" ON "learning_services"("key");
CREATE UNIQUE INDEX "learning_services_slug_key" ON "learning_services"("slug");
CREATE INDEX "learning_services_status_sort_order_title_idx"
  ON "learning_services"("status", "sort_order", "title");

INSERT INTO "learning_services" (
  "id", "key", "slug", "title", "description", "access_type",
  "course_mode", "enrollment_mode", "payment_requirement", "status", "sort_order"
)
VALUES
  (
    '20000000-0000-4000-8000-000000000001', 'BOOTCAMPS', 'bootcamps',
    'Bootcamps', 'Paid professional programs delivered through seasonal course intakes.',
    'PAID', 'SEASONAL', 'ADMIN', 'REQUIRED', 'ACTIVE', 1
  ),
  (
    '20000000-0000-4000-8000-000000000002', 'PRETECH', 'pretech-courses',
    'PreTech Courses', 'Paid preparation programs delivered through seasonal course intakes.',
    'PAID', 'SEASONAL', 'ADMIN', 'REQUIRED', 'ACTIVE', 2
  ),
  (
    '20000000-0000-4000-8000-000000000003', 'FREE_LEARNING', 'free-learning',
    'Free Learning', 'Self-paced courses available through free enrollment.',
    'FREE', 'EVERGREEN', 'SELF', 'NOT_REQUIRED', 'ACTIVE', 3
  );

ALTER TABLE "categories" ADD COLUMN "service_id" TEXT;

UPDATE "categories" AS category
SET "service_id" = service."id"
FROM "learning_services" AS service
WHERE service."key" = category."service_type"::text;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "categories" WHERE "service_id" IS NULL) THEN
    RAISE EXCEPTION 'Every existing category must map to a LearningService.';
  END IF;
END;
$$;

DROP INDEX "categories_service_type_status_sort_order_idx";
DROP INDEX "categories_service_type_slug_key";

ALTER TABLE "categories" ALTER COLUMN "service_id" SET NOT NULL;
ALTER TABLE "categories"
  ADD CONSTRAINT "categories_service_id_fkey"
  FOREIGN KEY ("service_id") REFERENCES "learning_services"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "categories_service_id_status_sort_order_idx"
  ON "categories"("service_id", "status", "sort_order");
CREATE UNIQUE INDEX "categories_service_id_slug_key"
  ON "categories"("service_id", "slug");

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

  IF EXISTS (SELECT 1 FROM categories WHERE service_id = OLD.id)
     AND (
       NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.access_type IS DISTINCT FROM OLD.access_type
       OR NEW.course_mode IS DISTINCT FROM OLD.course_mode
       OR NEW.enrollment_mode IS DISTINCT FROM OLD.enrollment_mode
       OR NEW.payment_requirement IS DISTINCT FROM OLD.payment_requirement
     ) THEN
    RAISE EXCEPTION 'LearningService identity and policy are immutable after its first Category.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'ARCHIVED' AND OLD.status <> 'ARCHIVED'
     AND EXISTS (
       SELECT 1
       FROM courses course
       JOIN categories category ON category.id = course.category_id
       WHERE category.service_id = OLD.id
         AND course.status IN ('OPEN_ACTIVE', 'CLOSED_ACTIVE')
     ) THEN
    RAISE EXCEPTION 'Complete or cancel every active Course before archiving this LearningService.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER learning_services_policy_immutable_trigger
BEFORE UPDATE ON "learning_services"
FOR EACH ROW EXECUTE FUNCTION prevent_used_learning_service_policy_change();

CREATE OR REPLACE FUNCTION require_archived_learning_service_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('learning-service:' || OLD.id));
  IF OLD.status <> 'ARCHIVED' THEN
    RAISE EXCEPTION 'Archive the LearningService before permanent deletion.'
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER learning_services_delete_lifecycle_trigger
BEFORE DELETE ON "learning_services"
FOR EACH ROW EXECUTE FUNCTION require_archived_learning_service_delete();

CREATE OR REPLACE FUNCTION prevent_category_service_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.service_id IS DISTINCT FROM OLD.service_id THEN
    RAISE EXCEPTION 'A Category cannot move to another LearningService.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER categories_service_immutable_trigger
BEFORE UPDATE OF "service_id" ON "categories"
FOR EACH ROW EXECUTE FUNCTION prevent_category_service_change();

CREATE OR REPLACE FUNCTION validate_course_learning_service_policy()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  service_id TEXT;
  service_access "LearningAccessType";
  service_mode "LearningCourseMode";
  service_status "LearningServiceStatus";
BEGIN
  SELECT service.id, service.access_type, service.course_mode, service.status
    INTO service_id, service_access, service_mode, service_status
  FROM course_groups course_group
  JOIN categories category ON category.id = course_group.category_id
  JOIN learning_services service ON service.id = category.service_id
  WHERE course_group.id = NEW.course_group_id
    AND category.id = NEW.category_id;

  IF service_id IS NULL THEN
    RAISE EXCEPTION 'CourseGroup, Category, and LearningService relationship is invalid.'
      USING ERRCODE = '23503';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('learning-service:' || service_id));
  PERFORM pg_advisory_xact_lock(hashtext('course-group:' || NEW.course_group_id));

  IF service_mode = 'SEASONAL' THEN
    IF NEW.start_date IS NULL OR NEW.expected_end_date IS NULL
       OR NEW.expected_end_date <= NEW.start_date THEN
      RAISE EXCEPTION 'Seasonal Courses require valid start and expected-end dates.'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.start_date IS NOT NULL OR NEW.expected_end_date IS NOT NULL THEN
      RAISE EXCEPTION 'Evergreen Courses cannot have intake dates.'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM courses existing
      WHERE existing.course_group_id = NEW.course_group_id
        AND existing.id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'An Evergreen LearningService CourseGroup can have only one Course.'
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF service_access = 'FREE' AND NEW.price <> 0 THEN
    RAISE EXCEPTION 'Free LearningService Courses must have zero price.'
      USING ERRCODE = '23514';
  END IF;
  IF service_access = 'PAID' AND NEW.price <= 0 THEN
    RAISE EXCEPTION 'Paid LearningService Courses must have a positive price.'
      USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'OPEN_ACTIVE' AND service_status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'Only an Active LearningService can expose an Open-Active Course.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER courses_learning_service_policy_trigger
BEFORE INSERT OR UPDATE OF "course_group_id", "category_id", "price", "start_date", "expected_end_date", "status"
ON "courses"
FOR EACH ROW EXECUTE FUNCTION validate_course_learning_service_policy();

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
BEFORE INSERT OR UPDATE OF "course_id", "source", "enrolled_by_user_id", "payment_status"
ON "enrollments"
FOR EACH ROW EXECUTE FUNCTION validate_enrollment_learning_service_policy();

DROP INDEX "courses_one_evergreen_per_group_idx";
ALTER TABLE "courses" DROP CONSTRAINT "courses_intake_shape_check";
ALTER TABLE "courses" DROP CONSTRAINT "courses_price_access_check";
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_source_shape_check";

ALTER TABLE "courses" DROP COLUMN "access_type", DROP COLUMN "instance_kind";
ALTER TABLE "categories" DROP COLUMN "service_type";

DROP TYPE "CourseAccessType";
DROP TYPE "CourseInstanceKind";
DROP TYPE "LearningServiceType";
