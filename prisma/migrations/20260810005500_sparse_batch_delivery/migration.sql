-- Legacy batch-session rows were materialized curriculum snapshots. The new
-- model stores only explicit delivery overrides, so hidden snapshot rows must
-- not be converted into delivery history.
DELETE FROM "batch_sessions";

DROP INDEX "batch_sessions_batch_id_order_index_key";
DROP INDEX "batch_sessions_course_id_idx";

ALTER TABLE "batch_sessions"
  DROP COLUMN "order_index",
  ADD COLUMN "historical_order_index" INTEGER;

CREATE INDEX "batch_sessions_course_id_batch_id_idx"
  ON "batch_sessions"("course_id", "batch_id");
