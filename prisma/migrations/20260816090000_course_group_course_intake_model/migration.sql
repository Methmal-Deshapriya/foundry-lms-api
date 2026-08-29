-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'OPEN_ACTIVE', 'CLOSED_ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourseInstanceKind" AS ENUM ('SEASONAL', 'EVERGREEN');

-- CreateEnum
CREATE TYPE "CourseSessionDeliveryStatus" AS ENUM ('UNRELEASED', 'SCHEDULED', 'RELEASED', 'WITHDRAWN');

-- DropForeignKey
ALTER TABLE "batch_sessions" DROP CONSTRAINT "batch_sessions_batch_id_course_id_fkey";

-- DropForeignKey
ALTER TABLE "batch_sessions" DROP CONSTRAINT "batch_sessions_course_session_id_course_id_fkey";

-- DropForeignKey
ALTER TABLE "batches" DROP CONSTRAINT "batches_course_id_fkey";

-- DropForeignKey
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_batch_id_course_id_fkey";

-- DropIndex
DROP INDEX "courses_category_id_slug_key";

-- DropIndex
DROP INDEX "enrollments_batch_id_created_at_id_idx";

-- DropIndex
DROP INDEX "enrollments_batch_id_status_idx";

-- DropIndex
DROP INDEX "enrollments_user_id_batch_id_key";

-- DropIndex
DROP INDEX "sessions_reuse_policy_status_idx";

-- AlterTable
ALTER TABLE "course_sessions" ADD COLUMN     "available_at" TIMESTAMP(3),
ADD COLUMN     "delivery_status" "CourseSessionDeliveryStatus" NOT NULL DEFAULT 'UNRELEASED',
ADD COLUMN     "first_released_at" TIMESTAMP(3),
ADD COLUMN     "historical_order_index" INTEGER;

-- AlterTable
ALTER TABLE "courses" DROP COLUMN "enrollment_status",
ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "course_group_id" TEXT NOT NULL,
ADD COLUMN     "expected_end_date" DATE,
ADD COLUMN     "instance_kind" "CourseInstanceKind" NOT NULL,
ADD COLUMN     "intake_key" TEXT NOT NULL,
ADD COLUMN     "start_date" DATE,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Asia/Colombo',
DROP COLUMN "status",
ADD COLUMN     "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT';

-- AlterTable
ALTER TABLE "enrollments" DROP COLUMN "batch_id";

-- AlterTable
ALTER TABLE "sessions" DROP COLUMN "reuse_policy";

-- DropTable
DROP TABLE "batch_sessions";

-- DropTable
DROP TABLE "batches";

-- DropEnum
DROP TYPE "BatchStatus";

-- DropEnum
DROP TYPE "CourseEnrollmentStatus";

-- DropEnum
DROP TYPE "SessionReusePolicy";

-- CreateTable
CREATE TABLE "course_groups" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "batch_code_prefix" TEXT NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_groups_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "course_groups_batch_code_prefix_key" ON "course_groups"("batch_code_prefix");

-- CreateIndex
CREATE INDEX "course_groups_category_id_archived_at_title_idx" ON "course_groups"("category_id", "archived_at", "title");

-- CreateIndex
CREATE UNIQUE INDEX "course_groups_id_category_id_key" ON "course_groups"("id", "category_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_groups_category_id_slug_key" ON "course_groups"("category_id", "slug");

-- CreateIndex
CREATE INDEX "course_sessions_course_id_delivery_status_available_at_idx" ON "course_sessions"("course_id", "delivery_status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_course_group_id_status_start_date_idx" ON "courses"("course_group_id", "status", "start_date");

-- CreateIndex
CREATE INDEX "courses_category_id_status_sort_order_idx" ON "courses"("category_id", "status", "sort_order");

-- CreateIndex
CREATE INDEX "courses_category_id_status_slug_idx" ON "courses"("category_id", "status", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "courses_course_group_id_intake_key_key" ON "courses"("course_group_id", "intake_key");

-- AddForeignKey
ALTER TABLE "course_groups" ADD CONSTRAINT "course_groups_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_course_group_id_category_id_fkey" FOREIGN KEY ("course_group_id", "category_id") REFERENCES "course_groups"("id", "category_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Dropping batch_id also drops the former partial index because its predicate
-- referenced that column. Recreate the final Course-level uniqueness rule.
CREATE UNIQUE INDEX "enrollments_user_id_course_id_key"
  ON "enrollments" ("user_id", "course_id");

-- The application serializes intake opening with a group advisory lock. This
-- partial unique index is the final database-level protection against two
-- concurrently public intakes for the same real-world course.
CREATE UNIQUE INDEX "courses_one_open_active_per_group_idx"
  ON "courses" ("course_group_id")
  WHERE "status" = 'OPEN_ACTIVE';

-- Free Learning has one long-lived course record per group.
CREATE UNIQUE INDEX "courses_one_evergreen_per_group_idx"
  ON "courses" ("course_group_id")
  WHERE "instance_kind" = 'EVERGREEN';

ALTER TABLE "courses"
  ADD CONSTRAINT "courses_intake_shape_check"
  CHECK (
    (
      "instance_kind" = 'SEASONAL'
      AND "start_date" IS NOT NULL
      AND "expected_end_date" IS NOT NULL
      AND "expected_end_date" > "start_date"
    )
    OR
    (
      "instance_kind" = 'EVERGREEN'
      AND "start_date" IS NULL
      AND "expected_end_date" IS NULL
    )
  ),
  ADD CONSTRAINT "courses_capacity_check"
  CHECK ("capacity" IS NULL OR "capacity" > 0),
  ADD CONSTRAINT "courses_timezone_check"
  CHECK (char_length(btrim("timezone")) > 0);

ALTER TABLE "course_sessions"
  ADD CONSTRAINT "course_sessions_delivery_state_check"
  CHECK (
    ("delivery_status" IN ('UNRELEASED', 'WITHDRAWN') AND "available_at" IS NULL)
    OR ("delivery_status" = 'SCHEDULED' AND "available_at" IS NOT NULL)
    OR ("delivery_status" = 'RELEASED' AND "available_at" IS NULL)
  );

-- Enrollment source now expresses the only paid/free distinction. It is
-- enforced below even for direct database writes.
ALTER TABLE "enrollments"
  ADD CONSTRAINT "enrollments_source_shape_check"
  CHECK (
    ("source" = 'SELF' AND "enrolled_by_user_id" IS NULL AND "payment_status" = 'NOT_REQUIRED')
    OR
    ("source" = 'ADMIN' AND "enrolled_by_user_id" IS NOT NULL AND "payment_status" <> 'NOT_REQUIRED')
  );
