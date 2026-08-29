CREATE TYPE "CourseEnrollmentStatus" AS ENUM ('COMING_SOON', 'OPEN', 'CLOSED');

ALTER TABLE "courses"
ADD COLUMN "enrollment_status" "CourseEnrollmentStatus" NOT NULL DEFAULT 'COMING_SOON';

-- Preserve the current behavior for already published courses that are ready
-- to accept learners. Empty free courses intentionally remain COMING_SOON.
UPDATE "courses" AS course
SET "enrollment_status" = 'OPEN'
WHERE course."status" = 'PUBLISHED'
  AND course."access_type" = 'FREE'
  AND EXISTS (
    SELECT 1
    FROM "course_sessions" AS course_session
    WHERE course_session."course_id" = course."id"
      AND course_session."retired_at" IS NULL
  );

-- Foundry Academy operates in LKR only. Normalize development data before
-- replacing the previous three-character currency constraint.
UPDATE "courses" SET "currency" = 'LKR' WHERE "currency" <> 'LKR';

ALTER TABLE "courses" DROP CONSTRAINT IF EXISTS "courses_currency_check";
ALTER TABLE "courses"
ADD CONSTRAINT "courses_currency_lkr_check" CHECK ("currency" = 'LKR');
