-- Course-detail public-page marketing content: who the course targets, why
-- a student should pursue it (numbered steps, same JSON-array pattern as
-- LearningService.processSteps), an explainer video (played the same way as
-- the landing page's AboutVideo component) and its optional R2-backed
-- thumbnail. All optional and editable after creation, like
-- highlights/skills/prerequisites already are. See the 2026-09-25 course
-- explainer content plan.
ALTER TYPE "StoredObjectPurpose" ADD VALUE 'COURSE_EXPLAINER_VIDEO_THUMBNAIL';

ALTER TABLE "courses" ADD COLUMN "target_audience" TEXT;
ALTER TABLE "courses" ADD COLUMN "why_pursue_steps" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "courses" ADD COLUMN "explainer_video_url" TEXT;
ALTER TABLE "courses" ADD COLUMN "explainer_video_thumbnail_object_id" TEXT;

CREATE INDEX "courses_explainer_video_thumbnail_object_id_idx" ON "courses"("explainer_video_thumbnail_object_id");

ALTER TABLE "courses" ADD CONSTRAINT "courses_explainer_video_thumbnail_object_id_fkey" FOREIGN KEY ("explainer_video_thumbnail_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
