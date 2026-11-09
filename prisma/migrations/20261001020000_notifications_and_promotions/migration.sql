-- In-app notifications, public promotions and a daily email counter (Phase 3
-- of the 2026-10-01 next-features plan). One notification row per message,
-- however many students it reaches; per-student rows only for read/dismiss.

-- CreateEnum
CREATE TYPE "NotificationAudience" AS ENUM ('ALL_STUDENTS', 'COURSE', 'INTAKE', 'PARTIAL_PAYERS');

-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PromotionTheme" AS ENUM ('DARK', 'LIGHT', 'RED');

-- AlterEnum
ALTER TYPE "StoredObjectPurpose" ADD VALUE 'PROMOTION_IMAGE';

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "audience" "NotificationAudience" NOT NULL,
    "course_id" TEXT,
    "intake_id" TEXT,
    "link_label" TEXT,
    "link_url" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "email_sent_count" INTEGER NOT NULL DEFAULT 0,
    "email_sent_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_receipts" (
    "id" TEXT NOT NULL,
    "notification_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),

    CONSTRAINT "notification_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promotions" (
    "id" TEXT NOT NULL,
    "internal_name" TEXT NOT NULL,
    "headline" TEXT NOT NULL,
    "message" TEXT,
    "badge" TEXT,
    "theme" "PromotionTheme" NOT NULL DEFAULT 'DARK',
    "image_object_id" TEXT,
    "cta_label" TEXT,
    "cta_url" TEXT,
    "show_countdown" BOOLEAN NOT NULL DEFAULT false,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "published_at" TIMESTAMP(3),
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_daily_usage" (
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "email_daily_usage_pkey" PRIMARY KEY ("day")
);

-- CreateIndex
CREATE INDEX "notifications_status_audience_idx" ON "notifications"("status", "audience");

-- CreateIndex
CREATE INDEX "notifications_course_id_idx" ON "notifications"("course_id");

-- CreateIndex
CREATE INDEX "notifications_intake_id_idx" ON "notifications"("intake_id");

-- CreateIndex
CREATE INDEX "notification_receipts_user_id_idx" ON "notification_receipts"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_receipts_notification_id_user_id_key" ON "notification_receipts"("notification_id", "user_id");

-- CreateIndex
CREATE INDEX "promotions_status_published_at_idx" ON "promotions"("status", "published_at");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "intakes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_receipts" ADD CONSTRAINT "notification_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_image_object_id_fkey" FOREIGN KEY ("image_object_id") REFERENCES "stored_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

