-- Partner earnings (2026-10-01 partner earnings plan): partners, their
-- dated share splits, expenses and payouts. Revenue is read from "payments".

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('ADVERTISING', 'INSTRUCTOR_FEES', 'SOFTWARE_HOSTING', 'VENUE', 'EQUIPMENT', 'TRANSPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "LedgerEntryKind" AS ENUM ('ENTRY', 'REVERSAL');

-- AlterEnum
ALTER TYPE "StoredObjectPurpose" ADD VALUE 'EXPENSE_RECEIPT';

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_sets" (
    "id" TEXT NOT NULL,
    "effective_from" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "share_set_entries" (
    "id" TEXT NOT NULL,
    "share_set_id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "share_set_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" TEXT NOT NULL,
    "spent_at" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "category" "ExpenseCategory" NOT NULL,
    "description" TEXT,
    "intake_id" TEXT,
    "paid_by_partner_id" TEXT,
    "receipt_object_id" TEXT,
    "kind" "LedgerEntryKind" NOT NULL DEFAULT 'ENTRY',
    "corrects_expense_id" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "partner_id" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'LKR',
    "paid_at" TIMESTAMP(3) NOT NULL,
    "method" "PaymentMethod",
    "reference" TEXT,
    "note" TEXT,
    "kind" "LedgerEntryKind" NOT NULL DEFAULT 'ENTRY',
    "corrects_payout_id" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "share_sets_effective_from_idx" ON "share_sets"("effective_from");

-- CreateIndex
CREATE UNIQUE INDEX "share_set_entries_share_set_id_partner_id_key" ON "share_set_entries"("share_set_id", "partner_id");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_receipt_object_id_key" ON "expenses"("receipt_object_id");

-- CreateIndex
CREATE INDEX "expenses_spent_at_idx" ON "expenses"("spent_at");

-- CreateIndex
CREATE INDEX "expenses_intake_id_idx" ON "expenses"("intake_id");

-- CreateIndex
CREATE INDEX "expenses_corrects_expense_id_idx" ON "expenses"("corrects_expense_id");

-- CreateIndex
CREATE INDEX "payouts_paid_at_idx" ON "payouts"("paid_at");

-- CreateIndex
CREATE INDEX "payouts_partner_id_idx" ON "payouts"("partner_id");

-- CreateIndex
CREATE INDEX "payouts_corrects_payout_id_idx" ON "payouts"("corrects_payout_id");

-- AddForeignKey
ALTER TABLE "share_sets" ADD CONSTRAINT "share_sets_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_set_entries" ADD CONSTRAINT "share_set_entries_share_set_id_fkey" FOREIGN KEY ("share_set_id") REFERENCES "share_sets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "share_set_entries" ADD CONSTRAINT "share_set_entries_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "intakes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_partner_id_fkey" FOREIGN KEY ("paid_by_partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_object_id_fkey" FOREIGN KEY ("receipt_object_id") REFERENCES "stored_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_corrects_expense_id_fkey" FOREIGN KEY ("corrects_expense_id") REFERENCES "expenses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_corrects_payout_id_fkey" FOREIGN KEY ("corrects_payout_id") REFERENCES "payouts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Seed: the three owners and their starting split (37.5 / 37.5 / 25),
-- effective from before the first ever payment so all existing revenue is
-- counted. Split changes later are new share sets, never edits to this one.
INSERT INTO "partners" ("id", "name", "display_order") VALUES
  (gen_random_uuid()::text, 'Anushka Sudeera', 1),
  (gen_random_uuid()::text, 'Methmal Deshapriya', 2),
  (gen_random_uuid()::text, 'Pasindu Prageesha', 3);

INSERT INTO "share_sets" ("id", "effective_from", "note")
VALUES (gen_random_uuid()::text, '2020-01-01T00:00:00.000Z', 'Founding split');

INSERT INTO "share_set_entries" ("id", "share_set_id", "partner_id", "percent")
SELECT gen_random_uuid()::text, s."id", p."id",
       CASE p."name" WHEN 'Pasindu Prageesha' THEN 25.00 ELSE 37.50 END
FROM "share_sets" s CROSS JOIN "partners" p
WHERE s."note" = 'Founding split';
