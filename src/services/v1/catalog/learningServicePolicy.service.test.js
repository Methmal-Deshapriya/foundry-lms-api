import { describe, expect, it } from "vitest";
import { LEARNING_SERVICE_TYPES } from "../../../constants/v1/catalog/catalog.constants.js";
import {
  assertCohortService,
  assertCourseConfigurationForService,
  assertSelfPacedService,
  requireLearningServicePolicy,
} from "./learningServicePolicy.service.js";

describe("learning-service policy assertions", () => {
  it("accepts paid cohort course configuration", () => {
    expect(
      assertCourseConfigurationForService(
        LEARNING_SERVICE_TYPES.BOOTCAMPS,
        { accessType: "PAID", price: 25000 },
        { requirePublishablePrice: true },
      ).requiresBatch,
    ).toBe(true);
  });

  it("rejects paid access for Free Learning", () => {
    expect(() =>
      assertCourseConfigurationForService(LEARNING_SERVICE_TYPES.FREE_LEARNING, {
        accessType: "PAID",
        price: 100,
      }),
    ).toThrow(/must use FREE access/i);
  });

  it("requires a positive price before publishing a cohort course", () => {
    expect(() =>
      assertCourseConfigurationForService(
        LEARNING_SERVICE_TYPES.PRETECH,
        { accessType: "PAID", price: 0 },
        { requirePublishablePrice: true },
      ),
    ).toThrow(/greater than zero/i);
  });

  it("separates cohort and self-paced operations", () => {
    expect(() => assertCohortService(LEARNING_SERVICE_TYPES.FREE_LEARNING)).toThrow(
      /only for cohort/i,
    );
    expect(() => assertSelfPacedService(LEARNING_SERVICE_TYPES.BOOTCAMPS)).toThrow(
      /only for self-paced/i,
    );
  });

  it("rejects services outside the LMS learning catalog", () => {
    expect(() => requireLearningServicePolicy("PROJECT_CONSULTATIONS")).toThrow(
      /unsupported learning service/i,
    );
  });
});

