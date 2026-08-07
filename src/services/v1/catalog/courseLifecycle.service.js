import { CATALOG_STATUSES } from "../../../constants/v1/catalog/catalog.constants.js";
import { ConflictError } from "../../../utils/Errors.js";

/**
 * Archived catalog records are retained for history and existing learner
 * access, but must not accept new operational activity.
 */
export function assertCourseAcceptsOperationalChanges(course) {
  if (
    course.status === CATALOG_STATUSES.ARCHIVED ||
    course.category?.status === CATALOG_STATUSES.ARCHIVED
  ) {
    throw new ConflictError(
      "Archived courses are read-only. New enrollments and session changes are not allowed.",
    );
  }
}
