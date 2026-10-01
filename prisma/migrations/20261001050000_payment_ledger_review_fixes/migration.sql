-- Code review M03 fixes (2026-10-01).

-- M03-01: remember the price each paid enrollment was agreed at, so later
-- course price edits never change what a partial payer owes.
ALTER TABLE "enrollments" ADD COLUMN "agreed_price" DECIMAL(12,2);

-- Backfill existing paid enrollments with their course's price as it is
-- now (no price has been edited since paid enrollments began, so this is
-- the price they agreed to).
UPDATE "enrollments" AS e
SET "agreed_price" = c."price"
FROM "courses" AS c
WHERE e."course_id" = c."id"
  AND e."payment_status" <> 'NOT_REQUIRED';

-- M03-20: the ledger is append-only; deleting an enrollment must not
-- cascade into its payment rows.
ALTER TABLE "payments" DROP CONSTRAINT "payments_enrollment_id_fkey";
ALTER TABLE "payments" ADD CONSTRAINT "payments_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
