import { describe, expect, it } from "vitest";
import { LEARNING_SERVICE_TYPES } from "./catalog.constants.js";
import {
  DELIVERY_MODES,
  ENROLLMENT_MODES,
  expectedAccessTypeForService,
  getLearningServicePolicy,
  isCohortService,
  isKnownLearningService,
  isSelfPacedService,
} from "./learningServicePolicy.constants.js";

describe("learning-service policy", () => {
  it.each([
    LEARNING_SERVICE_TYPES.BOOTCAMPS,
    LEARNING_SERVICE_TYPES.PRETECH,
  ])("treats %s as paid, admin-enrolled cohort delivery", (serviceType) => {
    expect(getLearningServicePolicy(serviceType)).toMatchObject({
      deliveryMode: DELIVERY_MODES.COHORT,
      enrollmentMode: ENROLLMENT_MODES.ADMIN,
      accessType: "PAID",
      requiresBatch: true,
      requiresCompletedPaymentForAccess: true,
    });
    expect(isCohortService(serviceType)).toBe(true);
  });

  it("treats Free Learning as free, self-enrolled, and self-paced", () => {
    expect(getLearningServicePolicy(LEARNING_SERVICE_TYPES.FREE_LEARNING)).toEqual({
      deliveryMode: DELIVERY_MODES.SELF_PACED,
      enrollmentMode: ENROLLMENT_MODES.SELF,
      accessType: "FREE",
      requiresBatch: false,
      requiresCompletedPaymentForAccess: false,
    });
    expect(isSelfPacedService(LEARNING_SERVICE_TYPES.FREE_LEARNING)).toBe(true);
  });

  it("returns safe values for unsupported service types", () => {
    expect(getLearningServicePolicy("PROJECT_CONSULTATIONS")).toBeNull();
    expect(expectedAccessTypeForService("PROJECT_CONSULTATIONS")).toBeNull();
    expect(isKnownLearningService("PROJECT_CONSULTATIONS")).toBe(false);
  });
});

