-- "Notify me when it opens" (Phase 4b of the 2026-10-01 next-features plan):
-- a student's interest in a not-yet-enrolling course, and the notification
-- audience that reaches them when an intake opens.

-- AlterEnum
ALTER TYPE "NotificationAudience" ADD VALUE 'COURSE_INTEREST';

-- CreateTable
CREATE TABLE "course_interests" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notified_at" TIMESTAMP(3),

    CONSTRAINT "course_interests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_interests_course_id_idx" ON "course_interests"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_interests_user_id_course_id_key" ON "course_interests"("user_id", "course_id");

-- AddForeignKey
ALTER TABLE "course_interests" ADD CONSTRAINT "course_interests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_interests" ADD CONSTRAINT "course_interests_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

