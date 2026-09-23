-- CreateEnum
CREATE TYPE "StoredObjectScope" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "StoredObjectPurpose" AS ENUM ('COURSE_THUMBNAIL', 'SESSION_RECORDING', 'SESSION_MATERIAL');

-- CreateEnum
CREATE TYPE "StoredObjectStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "stored_objects" (
    "id" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "scope" "StoredObjectScope" NOT NULL,
    "purpose" "StoredObjectPurpose" NOT NULL,
    "status" "StoredObjectStatus" NOT NULL DEFAULT 'PENDING',
    "original_file_name" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "declared_size_bytes" BIGINT NOT NULL,
    "actual_size_bytes" BIGINT,
    "etag" TEXT,
    "uploaded_by_user_id" TEXT NOT NULL,
    "ready_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "courses" ADD COLUMN "thumbnail_object_id" TEXT;
ALTER TABLE "sessions" ADD COLUMN "recording_object_id" TEXT;
ALTER TABLE "sessions" ADD COLUMN "material_object_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "stored_objects_object_key_key" ON "stored_objects"("object_key");
CREATE INDEX "stored_objects_status_created_at_idx" ON "stored_objects"("status", "created_at");
CREATE INDEX "stored_objects_uploaded_by_user_id_created_at_idx" ON "stored_objects"("uploaded_by_user_id", "created_at" DESC);
CREATE INDEX "stored_objects_purpose_status_idx" ON "stored_objects"("purpose", "status");
CREATE INDEX "courses_thumbnail_object_id_idx" ON "courses"("thumbnail_object_id");
CREATE INDEX "sessions_recording_object_id_idx" ON "sessions"("recording_object_id");
CREATE INDEX "sessions_material_object_id_idx" ON "sessions"("material_object_id");

-- AddForeignKey
ALTER TABLE "stored_objects" ADD CONSTRAINT "stored_objects_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "courses" ADD CONSTRAINT "courses_thumbnail_object_id_fkey" FOREIGN KEY ("thumbnail_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_recording_object_id_fkey" FOREIGN KEY ("recording_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_material_object_id_fkey" FOREIGN KEY ("material_object_id") REFERENCES "stored_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
