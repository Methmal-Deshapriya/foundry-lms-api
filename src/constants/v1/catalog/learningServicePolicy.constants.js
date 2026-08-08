import {
  COURSE_ACCESS_TYPES,
  LEARNING_SERVICE_TYPES,
} from "./catalog.constants.js";

export const DELIVERY_MODES = Object.freeze({
  COHORT: "COHORT",
  SELF_PACED: "SELF_PACED",
});

export const ENROLLMENT_MODES = Object.freeze({
  ADMIN: "ADMIN",
  SELF: "SELF",
});

export const LEARNING_SERVICE_DEFINITIONS = Object.freeze([
  Object.freeze({
    type: LEARNING_SERVICE_TYPES.BOOTCAMPS,
    slug: "bootcamps",
    label: "Bootcamps",
    description: "Paid, batch-based professional learning programs.",
  }),
  Object.freeze({
    type: LEARNING_SERVICE_TYPES.PRETECH,
    slug: "pretech-courses",
    label: "PreTech Courses",
    description: "Paid, batch-based preparation courses.",
  }),
  Object.freeze({
    type: LEARNING_SERVICE_TYPES.FREE_LEARNING,
    slug: "free-learning",
    label: "Free Learning",
    description: "Self-paced courses available through free enrollment.",
  }),
]);

export const LEARNING_SERVICE_POLICIES = Object.freeze({
  [LEARNING_SERVICE_TYPES.BOOTCAMPS]: Object.freeze({
    deliveryMode: DELIVERY_MODES.COHORT,
    enrollmentMode: ENROLLMENT_MODES.ADMIN,
    accessType: "PAID",
    requiresBatch: true,
    requiresCompletedPaymentForAccess: true,
  }),
  [LEARNING_SERVICE_TYPES.PRETECH]: Object.freeze({
    deliveryMode: DELIVERY_MODES.COHORT,
    enrollmentMode: ENROLLMENT_MODES.ADMIN,
    accessType: "PAID",
    requiresBatch: true,
    requiresCompletedPaymentForAccess: true,
  }),
  [LEARNING_SERVICE_TYPES.FREE_LEARNING]: Object.freeze({
    deliveryMode: DELIVERY_MODES.SELF_PACED,
    enrollmentMode: ENROLLMENT_MODES.SELF,
    accessType: "FREE",
    requiresBatch: false,
    requiresCompletedPaymentForAccess: false,
  }),
});

export function getLearningServicePolicy(serviceType) {
  return LEARNING_SERVICE_POLICIES[serviceType] ?? null;
}

export function isCohortService(serviceType) {
  return getLearningServicePolicy(serviceType)?.deliveryMode === DELIVERY_MODES.COHORT;
}

export function isSelfPacedService(serviceType) {
  return (
    getLearningServicePolicy(serviceType)?.deliveryMode === DELIVERY_MODES.SELF_PACED
  );
}

export function expectedAccessTypeForService(serviceType) {
  return getLearningServicePolicy(serviceType)?.accessType ?? null;
}

export function isKnownLearningService(serviceType) {
  return Boolean(getLearningServicePolicy(serviceType));
}

if (
  !Object.values(LEARNING_SERVICE_POLICIES).every((policy) =>
    COURSE_ACCESS_TYPES.includes(policy.accessType),
  )
) {
  throw new Error("Learning-service policy contains an unsupported access type.");
}
