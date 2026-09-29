-- Stage 1 of the dynamic-service-content plan: a learning service created
-- through the admin UI previously had nowhere to store the public Level-2
-- page's hook headline or hero image (both were hardcoded per-slug in the
-- frontend), so any new service rendered with a blank hero. Same
-- R2-backed-image pattern as Course/StudentProject's thumbnailObjectId.
ALTER TYPE "StoredObjectPurpose" ADD VALUE 'SERVICE_HERO';

ALTER TABLE "learning_services" ADD COLUMN "hero_headline" TEXT;
ALTER TABLE "learning_services" ADD COLUMN "hero_image_object_id" TEXT;

CREATE INDEX "learning_services_hero_image_object_id_idx" ON "learning_services"("hero_image_object_id");

ALTER TABLE "learning_services" ADD CONSTRAINT "learning_services_hero_image_object_id_fkey" FOREIGN KEY ("hero_image_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
