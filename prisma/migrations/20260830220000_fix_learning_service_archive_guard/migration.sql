-- Corrects a latent bug from the course-to-program-intake rename migration
-- (20260830150000): this trigger's function body still queried `courses`
-- for a `status` column to decide whether a LearningService has active
-- learning underneath it. After the rename, `courses` means the new
-- Course/program table, which has no `status` column at all (only the
-- renamed table, `intakes`, has one) — so this check silently pointed at
-- the wrong table. "Active Course" always meant "an active run", i.e. an
-- Intake with OPEN_ACTIVE/CLOSED_ACTIVE status, so this now queries
-- `intakes` directly instead.

CREATE OR REPLACE FUNCTION prevent_used_learning_service_policy_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('learning-service:' || OLD.id));

  IF NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'LearningService key is immutable after creation.'
      USING ERRCODE = '23514';
  END IF;

  IF EXISTS (SELECT 1 FROM categories WHERE service_id = OLD.id)
     AND (
       NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.access_type IS DISTINCT FROM OLD.access_type
       OR NEW.course_mode IS DISTINCT FROM OLD.course_mode
       OR NEW.enrollment_mode IS DISTINCT FROM OLD.enrollment_mode
       OR NEW.payment_requirement IS DISTINCT FROM OLD.payment_requirement
     ) THEN
    RAISE EXCEPTION 'LearningService identity and policy are immutable after its first Category.'
      USING ERRCODE = '23514';
  END IF;

  IF NEW.status = 'ARCHIVED' AND OLD.status <> 'ARCHIVED'
     AND EXISTS (
       SELECT 1
       FROM intakes intake
       JOIN categories category ON category.id = intake.category_id
       WHERE category.service_id = OLD.id
         AND intake.status IN ('OPEN_ACTIVE', 'CLOSED_ACTIVE')
     ) THEN
    RAISE EXCEPTION 'Complete or cancel every active Intake before archiving this LearningService.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;
