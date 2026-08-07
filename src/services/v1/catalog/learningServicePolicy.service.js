import {
  DELIVERY_MODES,
  ENROLLMENT_MODES,
  getLearningServicePolicy,
} from "../../../constants/v1/catalog/learningServicePolicy.constants.js";
import { ConflictError, ValidationError } from "../../../utils/Errors.js";

export function requireLearningServicePolicy(serviceType) {
  const policy = getLearningServicePolicy(serviceType);
  if (!policy) {
    throw new ValidationError("Unsupported learning service.", "serviceType");
  }
  return policy;
}

export function assertCourseConfigurationForService(
  serviceType,
  { accessType, price },
  { requirePublishablePrice = false } = {},
) {
  const policy = requireLearningServicePolicy(serviceType);
  const numericPrice = Number(price);

  if (accessType !== policy.accessType) {
    throw new ValidationError(
      `${serviceType} courses must use ${policy.accessType} access.`,
      "accessType",
    );
  }

  if (policy.accessType === "FREE" && numericPrice !== 0) {
    throw new ValidationError("Free Learning courses must have a zero price.", "price");
  }

  if (
    policy.accessType === "PAID" &&
    requirePublishablePrice &&
    (!Number.isFinite(numericPrice) || numericPrice <= 0)
  ) {
    throw new ValidationError(
      "Published Bootcamp and PreTech courses must have a price greater than zero.",
      "price",
    );
  }

  return policy;
}

export function assertCohortService(serviceType) {
  const policy = requireLearningServicePolicy(serviceType);
  if (
    policy.deliveryMode !== DELIVERY_MODES.COHORT ||
    policy.enrollmentMode !== ENROLLMENT_MODES.ADMIN
  ) {
    throw new ConflictError("This operation is available only for cohort courses.");
  }
  return policy;
}

export function assertSelfPacedService(serviceType) {
  const policy = requireLearningServicePolicy(serviceType);
  if (
    policy.deliveryMode !== DELIVERY_MODES.SELF_PACED ||
    policy.enrollmentMode !== ENROLLMENT_MODES.SELF
  ) {
    throw new ConflictError("This operation is available only for self-paced courses.");
  }
  return policy;
}

