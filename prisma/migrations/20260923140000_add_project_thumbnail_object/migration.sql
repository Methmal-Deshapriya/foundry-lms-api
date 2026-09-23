-- Lets a student attach an R2-uploaded thumbnail to a StudentProject, same
-- pattern as Course/Session: a nullable FK to stored_objects alongside the
-- existing external-URL field, mutually exclusive at the application layer.
ALTER TYPE "StoredObjectPurpose" ADD VALUE 'PROJECT_THUMBNAIL';

ALTER TABLE "student_projects" ADD COLUMN "thumbnail_object_id" TEXT;

CREATE INDEX "student_projects_thumbnail_object_id_idx" ON "student_projects"("thumbnail_object_id");

ALTER TABLE "student_projects" ADD CONSTRAINT "student_projects_thumbnail_object_id_fkey" FOREIGN KEY ("thumbnail_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
