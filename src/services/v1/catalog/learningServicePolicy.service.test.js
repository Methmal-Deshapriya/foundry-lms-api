import { describe, expect, it } from "vitest";
import {
  allowsAdminEnrollment,
  allowsSelfEnrollment,
  deriveCoursePolicy,
  isFree,
  isPaid,
  requiresCompletedPayment,
  usesEvergreenCourse,
  usesSeasonalCourses,
} from "./learningServicePolicy.service.js";

const paid = {
  id: "paid",
  accessType: "PAID",
  courseMode: "SEASONAL",
  enrollmentMode: "ADMIN",
  paymentRequirement: "REQUIRED",
};
const free = {
  id: "free",
  accessType: "FREE",
  courseMode: "EVERGREEN",
  enrollmentMode: "SELF",
  paymentRequirement: "NOT_REQUIRED",
};

describe("database-backed learning-service policy predicates", () => {
  it("derives the paid seasonal workflow from a loaded service", () => {
    expect(isPaid(paid)).toBe(true);
    expect(usesSeasonalCourses(paid)).toBe(true);
    expect(allowsAdminEnrollment(paid)).toBe(true);
    expect(requiresCompletedPayment(paid)).toBe(true);
    expect(deriveCoursePolicy(paid)).toMatchObject({
      accessType: "PAID",
      instanceKind: "SEASONAL",
    });
  });

  it("derives the free evergreen workflow from a loaded service", () => {
    expect(isFree(free)).toBe(true);
    expect(usesEvergreenCourse(free)).toBe(true);
    expect(allowsSelfEnrollment(free)).toBe(true);
    expect(requiresCompletedPayment(free)).toBe(false);
  });

  it("rejects policy decisions without a loaded database entity", () => {
    expect(() => isFree(null)).toThrow(/loaded LearningService/i);
  });
});
