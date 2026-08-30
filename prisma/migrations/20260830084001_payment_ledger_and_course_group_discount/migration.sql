-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('FULL', 'PARTIAL', 'TOP_UP');

-- AlterEnum
-- `enrollments_learning_service_policy_trigger` and two CHECK constraints (from
-- earlier migrations) reference payment_status, which blocks an in-place column
-- type change while any of them exist. Drop them for the swap and recreate them
-- identically afterward — none of their bodies reference 'PENDING', the value
-- actually being removed, so behavior is unaffected once they're back.
BEGIN;
DROP TRIGGER IF EXISTS "enrollments_learning_service_policy_trigger" ON "enrollments";
ALTER TABLE "enrollments" DROP CONSTRAINT IF EXISTS "enrollments_payment_mode_check";
ALTER TABLE "enrollments" DROP CONSTRAINT IF EXISTS "enrollments_payment_completed_at_check";
CREATE TYPE "PaymentStatus_new" AS ENUM ('NOT_REQUIRED', 'PARTIAL', 'COMPLETED');
ALTER TABLE "public"."enrollments" ALTER COLUMN "payment_status" DROP DEFAULT;
ALTER TABLE "enrollments" ALTER COLUMN "payment_status" TYPE "PaymentStatus_new" USING ("payment_status"::text::"PaymentStatus_new");
ALTER TYPE "PaymentStatus" RENAME TO "PaymentStatus_old";
ALTER TYPE "PaymentStatus_new" RENAME TO "PaymentStatus";
DROP TYPE "public"."PaymentStatus_old";
ALTER TABLE "enrollments" ALTER COLUMN "payment_status" SET DEFAULT 'NOT_REQUIRED';
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_payment_mode_check" CHECK (("source" = 'SELF' AND "payment_status" = 'NOT_REQUIRED') OR ("source" = 'ADMIN' AND "payment_status" <> 'NOT_REQUIRED'));
ALTER TABLE "enrollments" ADD CONSTRAINT "enrollments_payment_completed_at_check" CHECK (("payment_status" = 'COMPLETED' AND "payment_completed_at" IS NOT NULL) OR ("payment_status" <> 'COMPLETED' AND "payment_completed_at" IS NULL));
CREATE TRIGGER "enrollments_learning_service_policy_trigger" BEFORE INSERT OR UPDATE OF course_id, source, enrolled_by_user_id, payment_status ON "enrollments" FOR EACH ROW EXECUTE FUNCTION validate_enrollment_learning_service_policy();
COMMIT;

-- AlterTable
ALTER TABLE "course_groups" ADD COLUMN     "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "enrollments" ALTER COLUMN "payment_status" SET DEFAULT 'NOT_REQUIRED';

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "enrollment_id" TEXT NOT NULL,
    "course_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "discount_amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "type" "PaymentType" NOT NULL,
    "external_reference" TEXT,
    "note" TEXT,
    "recorded_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payments_course_id_created_at_idx" ON "payments"("course_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_enrollment_id_created_at_idx" ON "payments"("enrollment_id", "created_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

