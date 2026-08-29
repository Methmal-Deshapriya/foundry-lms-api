import { describe, expect, it } from "vitest";
import {
  ConflictError,
  DatabaseError,
  NotFoundError,
  ValidationError,
  handlePrismaError,
} from "./Errors.js";

describe("handlePrismaError", () => {
  it("passes an already-classified CustomError through unchanged", () => {
    const original = new ValidationError("Bad input", "title");
    expect(handlePrismaError(original)).toBe(original);
  });

  it("maps a unique-constraint violation to a safe ConflictError", () => {
    const result = handlePrismaError({ code: "P2002", message: "raw prisma detail" });
    expect(result).toBeInstanceOf(ConflictError);
    expect(result.message).not.toContain("raw prisma detail");
  });

  it("maps a missing-record error to a safe NotFoundError", () => {
    const result = handlePrismaError({ code: "P2025", message: "raw prisma detail" });
    expect(result).toBeInstanceOf(NotFoundError);
    expect(result.message).not.toContain("raw prisma detail");
  });

  it("never leaks the raw Prisma message to the client for unclassified failures", () => {
    const rawError = {
      message:
        'Invalid `prisma.session.update()` invocation: Unknown argument `tags`. Did you mean `status`?',
      stack: "PrismaClientValidationError: ...",
    };

    const result = handlePrismaError(rawError);

    expect(result).toBeInstanceOf(DatabaseError);
    expect(result.message).not.toContain("prisma");
    expect(result.message).not.toContain("tags");
    // The real detail must still be reachable for server-side logging.
    expect(result.originalError).toBe(rawError);
  });
});
