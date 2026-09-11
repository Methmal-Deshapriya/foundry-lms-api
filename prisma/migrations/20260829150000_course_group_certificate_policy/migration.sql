-- A certificate policy describes the real-world program, not one seasonal
-- intake. Move the immutable policy to course_groups so every sibling intake
-- is governed by the same database-owned decision.
ALTER TABLE course_groups
ADD COLUMN certificate_enabled BOOLEAN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM courses
    GROUP BY course_group_id
    HAVING COUNT(DISTINCT certificate_enabled) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot migrate inconsistent certificate policies within a course group.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

UPDATE course_groups AS course_group
SET certificate_enabled = COALESCE((
  SELECT BOOL_OR(course.certificate_enabled)
  FROM courses AS course
  WHERE course.course_group_id = course_group.id
), FALSE);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM certificates AS certificate
    JOIN enrollments AS enrollment ON enrollment.id = certificate.enrollment_id
    JOIN courses AS course ON course.id = enrollment.course_id
    JOIN course_groups AS course_group ON course_group.id = course.course_group_id
    WHERE course_group.certificate_enabled IS FALSE
  ) THEN
    RAISE EXCEPTION 'Cannot migrate certificates issued for a certificate-disabled course group.'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

ALTER TABLE course_groups
ALTER COLUMN certificate_enabled SET NOT NULL;

DROP TRIGGER IF EXISTS courses_certificate_policy_immutable ON courses;
DROP FUNCTION IF EXISTS prevent_course_certificate_policy_change();

ALTER TABLE courses
DROP COLUMN certificate_enabled;

CREATE OR REPLACE FUNCTION prevent_course_group_certificate_policy_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.certificate_enabled IS DISTINCT FROM OLD.certificate_enabled THEN
    RAISE EXCEPTION 'Course-group certificate policy is immutable after creation.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER course_groups_certificate_policy_immutable
BEFORE UPDATE OF certificate_enabled ON course_groups
FOR EACH ROW
EXECUTE FUNCTION prevent_course_group_certificate_policy_change();

CREATE OR REPLACE FUNCTION validate_certificate_course_group_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  certificate_support_enabled BOOLEAN;
BEGIN
  SELECT course_group.certificate_enabled
  INTO certificate_support_enabled
  FROM enrollments AS enrollment
  JOIN courses AS course ON course.id = enrollment.course_id
  JOIN course_groups AS course_group ON course_group.id = course.course_group_id
  WHERE enrollment.id = NEW.enrollment_id;

  IF certificate_support_enabled IS NULL THEN
    RAISE EXCEPTION 'Certificate enrollment does not resolve to a course group.'
      USING ERRCODE = '23503';
  END IF;

  IF certificate_support_enabled IS FALSE THEN
    RAISE EXCEPTION 'Certificates are disabled for this course group.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER certificates_course_group_policy_guard
BEFORE INSERT OR UPDATE OF enrollment_id ON certificates
FOR EACH ROW
EXECUTE FUNCTION validate_certificate_course_group_policy();
