import { describe, expect, it } from "vitest";
import { ConflictError } from "../../../utils/Errors.js";
import { assertCourseAcceptsOperationalChanges } from "./courseLifecycle.service.js";

describe("course lifecycle operations", () => {
  it("allows operational changes for draft and published courses", () => {
    expect(() =>
      assertCourseAcceptsOperationalChanges({
        status: "DRAFT",
        category: { status: "PUBLISHED" },
      }),
    ).not.toThrow();
    expect(() =>
      assertCourseAcceptsOperationalChanges({
        status: "PUBLISHED",
        category: { status: "PUBLISHED" },
      }),
    ).not.toThrow();
  });

  it("rejects an archived course", () => {
    expect(() =>
      assertCourseAcceptsOperationalChanges({
        status: "ARCHIVED",
        category: { status: "PUBLISHED" },
      }),
    ).toThrow(ConflictError);
  });

  it("rejects a course whose parent category is archived", () => {
    expect(() =>
      assertCourseAcceptsOperationalChanges({
        status: "PUBLISHED",
        category: { status: "ARCHIVED" },
      }),
    ).toThrow(ConflictError);
  });
});
