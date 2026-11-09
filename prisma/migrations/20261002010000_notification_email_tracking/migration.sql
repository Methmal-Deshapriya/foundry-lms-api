-- Code review M09-01 / M09-02: one email send at a time per notification,
-- and per-student email tracking so missed students can be emailed later.
ALTER TABLE "notifications" ADD COLUMN "email_sending_at" TIMESTAMP(3);
ALTER TABLE "notification_receipts" ADD COLUMN "emailed_at" TIMESTAMP(3);
