-- Code review M10-05: super admins can suspend an account.
ALTER TABLE "users" ADD COLUMN "disabled_at" TIMESTAMP(3);

-- Code review M10-10: deleting a user or an enrollment by hand must never
-- cascade into enrollments and issued certificates (payments are already
-- RESTRICT since 20261001050000). No data changes.
ALTER TABLE "enrollments" DROP CONSTRAINT "enrollments_user_id_fkey";
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "certificates" DROP CONSTRAINT "certificates_enrollment_id_fkey";
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
