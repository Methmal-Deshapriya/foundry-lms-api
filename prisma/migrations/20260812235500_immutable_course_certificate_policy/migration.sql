-- Certificate support is an academic policy selected once when a course is
-- created. Keeping it immutable prevents one batch-level action from changing
-- completion requirements for every current and historical intake.
CREATE OR REPLACE FUNCTION prevent_course_certificate_policy_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.certificate_enabled IS DISTINCT FROM OLD.certificate_enabled THEN
    RAISE EXCEPTION 'Course certificate policy is immutable after creation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER courses_certificate_policy_immutable
BEFORE UPDATE OF certificate_enabled ON courses
FOR EACH ROW
EXECUTE FUNCTION prevent_course_certificate_policy_change();
