-- Code review M08-09: remember a student's earlier profile links.
ALTER TABLE "student_profiles" ADD COLUMN "previous_slugs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
