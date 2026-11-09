-- Payment ledger workspace (Phase 2 of the 2026-10-01 next-features plan).
-- Payments stay append-only: corrections are new REFUND / REVERSAL rows
-- with NEGATIVE amounts that point at the entry they correct, so every
-- existing SUM(amount) revenue figure keeps meaning "net money received".
-- Adds how the money moved, when it was actually received, a sequential
-- receipt number, and an optional private proof-of-payment photo.
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'ONLINE', 'OTHER');

ALTER TYPE "PaymentType" ADD VALUE 'REFUND';
ALTER TYPE "PaymentType" ADD VALUE 'REVERSAL';
ALTER TYPE "StoredObjectPurpose" ADD VALUE 'PAYMENT_PROOF';

ALTER TABLE "payments" ADD COLUMN "method" "PaymentMethod";
ALTER TABLE "payments" ADD COLUMN "corrects_payment_id" TEXT;
ALTER TABLE "payments" ADD COLUMN "proof_object_id" TEXT;

-- Existing entries were received when they were recorded.
ALTER TABLE "payments" ADD COLUMN "paid_at" TIMESTAMP(3);
UPDATE "payments" SET "paid_at" = "created_at";
ALTER TABLE "payments" ALTER COLUMN "paid_at" SET NOT NULL;
ALTER TABLE "payments" ALTER COLUMN "paid_at" SET DEFAULT CURRENT_TIMESTAMP;

-- Receipt numbers: existing entries are numbered oldest-first, then the
-- sequence carries on from the highest number.
ALTER TABLE "payments" ADD COLUMN "receipt_sequence" SERIAL NOT NULL;
UPDATE "payments" p
SET "receipt_sequence" = ordered.rn
FROM (SELECT "id", ROW_NUMBER() OVER (ORDER BY "created_at", "id") AS rn FROM "payments") ordered
WHERE p."id" = ordered."id";
SELECT setval(pg_get_serial_sequence('"payments"', 'receipt_sequence'), COALESCE((SELECT MAX("receipt_sequence") FROM "payments"), 0) + 1, false);

CREATE UNIQUE INDEX "payments_receipt_sequence_key" ON "payments"("receipt_sequence");
CREATE UNIQUE INDEX "payments_proof_object_id_key" ON "payments"("proof_object_id");
CREATE INDEX "payments_paid_at_idx" ON "payments"("paid_at");
CREATE INDEX "payments_corrects_payment_id_idx" ON "payments"("corrects_payment_id");

ALTER TABLE "payments" ADD CONSTRAINT "payments_proof_object_id_fkey" FOREIGN KEY ("proof_object_id") REFERENCES "stored_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "payments" ADD CONSTRAINT "payments_corrects_payment_id_fkey" FOREIGN KEY ("corrects_payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
