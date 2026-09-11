-- CreateEnum
CREATE TYPE "LearningServiceType" AS ENUM ('BOOTCAMPS', 'PRETECH', 'FREE_LEARNING');

-- CreateEnum
CREATE TYPE "CatalogStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "CourseLevel" AS ENUM ('OPEN', 'FOUNDATION', 'BEGINNER', 'INTERMEDIATE', 'ADVANCED');

-- CreateEnum
CREATE TYPE "DurationUnit" AS ENUM ('SESSION', 'DAY', 'WEEK', 'MONTH');

-- CreateEnum
CREATE TYPE "CourseAccessType" AS ENUM ('FREE', 'PAID');

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE 'NOT_REQUIRED';

-- Remove the development-only bootcamp catalog relations. The database is
-- reset when this migration is introduced, so no production data is migrated.
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_bootcamp_id_fkey";
ALTER TABLE "sessions" DROP CONSTRAINT "sessions_bootcamp_id_fkey";
ALTER TABLE "student_projects" DROP CONSTRAINT "student_projects_bootcamp_id_fkey";

DROP INDEX "enrollments_user_id_bootcamp_id_key";
DROP INDEX "sessions_bootcamp_id_is_published_order_index_idx";
DROP INDEX "sessions_bootcamp_id_order_index_key";
DROP INDEX "student_projects_bootcamp_id_status_is_public_idx";

ALTER TABLE "certificates" DROP COLUMN "bootcamp_name",
ADD COLUMN "course_name" TEXT NOT NULL;

ALTER TABLE "enrollments" DROP COLUMN "bootcamp_id",
ADD COLUMN "course_id" TEXT NOT NULL;

ALTER TABLE "sessions" DROP COLUMN "bootcamp_id",
ADD COLUMN "course_id" TEXT NOT NULL;

ALTER TABLE "student_projects" DROP COLUMN "bootcamp_id",
ADD COLUMN "course_id" TEXT NOT NULL;

DROP TABLE "bootcamps";

CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "service_type" "LearningServiceType" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "audience_label" TEXT,
    "visual_key" TEXT NOT NULL,
    "badge_label" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "courses" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "level" "CourseLevel" NOT NULL,
    "duration_value" INTEGER,
    "duration_unit" "DurationUnit",
    "access_type" "CourseAccessType" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "certificate_enabled" BOOLEAN NOT NULL DEFAULT false,
    "highlights" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "prerequisites" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbnail_url" TEXT,
    "status" "CatalogStatus" NOT NULL DEFAULT 'DRAFT',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "courses_price_access_check" CHECK (
      ("access_type" = 'FREE' AND "price" = 0)
      OR ("access_type" = 'PAID' AND "price" >= 0)
    ),
    CONSTRAINT "courses_duration_check" CHECK (
      ("duration_value" IS NULL AND "duration_unit" IS NULL)
      OR ("duration_value" > 0 AND "duration_unit" IS NOT NULL)
    ),
    CONSTRAINT "courses_currency_check" CHECK (char_length("currency") = 3)
);

CREATE INDEX "categories_service_type_status_sort_order_idx" ON "categories"("service_type", "status", "sort_order");
CREATE UNIQUE INDEX "categories_service_type_slug_key" ON "categories"("service_type", "slug");
CREATE INDEX "courses_category_id_status_sort_order_idx" ON "courses"("category_id", "status", "sort_order");
CREATE UNIQUE INDEX "courses_category_id_slug_key" ON "courses"("category_id", "slug");
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");
CREATE INDEX "certificates_status_issued_date_idx" ON "certificates"("status", "issued_date");
CREATE INDEX "email_otps_expires_at_idx" ON "email_otps"("expires_at");
CREATE INDEX "enrollments_course_id_status_idx" ON "enrollments"("course_id", "status");
CREATE UNIQUE INDEX "enrollments_user_id_course_id_key" ON "enrollments"("user_id", "course_id");
CREATE INDEX "sessions_course_id_is_published_order_index_idx" ON "sessions"("course_id", "is_published", "order_index");
CREATE UNIQUE INDEX "sessions_course_id_order_index_key" ON "sessions"("course_id", "order_index");
CREATE INDEX "student_projects_course_id_status_is_public_idx" ON "student_projects"("course_id", "status", "is_public");

ALTER TABLE "courses" ADD CONSTRAINT "courses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_projects" ADD CONSTRAINT "student_projects_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
