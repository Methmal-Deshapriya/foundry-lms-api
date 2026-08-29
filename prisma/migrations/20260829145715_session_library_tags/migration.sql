-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "sessions_tags_idx" ON "sessions" USING GIN ("tags");
