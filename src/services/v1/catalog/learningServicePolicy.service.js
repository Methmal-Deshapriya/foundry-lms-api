import { ValidationError } from "../../../utils/Errors.js";

function requireService(service) {
  if (!service?.id || !service.accessType || !service.courseMode) {
    throw new ValidationError(
      "A loaded LearningService policy is required.",
      "learningService",
    );
  }
  return service;
}

export const isPaid = (service) => requireService(service).accessType === "PAID";
export const isFree = (service) => requireService(service).accessType === "FREE";
export const usesSeasonalCourses = (service) =>
  requireService(service).courseMode === "SEASONAL";
export const usesEvergreenCourse = (service) =>
  requireService(service).courseMode === "EVERGREEN";
export const allowsAdminEnrollment = (service) =>
  requireService(service).enrollmentMode === "ADMIN";
export const allowsSelfEnrollment = (service) =>
  requireService(service).enrollmentMode === "SELF";
export const requiresCompletedPayment = (service) =>
  requireService(service).paymentRequirement === "REQUIRED";

export function deriveCoursePolicy(service) {
  const policy = requireService(service);
  return Object.freeze({
    accessType: policy.accessType,
    instanceKind: policy.courseMode,
    enrollmentMode: policy.enrollmentMode,
    paymentRequirement: policy.paymentRequirement,
  });
}
