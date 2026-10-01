import { describe, expect, it } from "vitest";
import { createEnrollmentRequestSchema } from "./enrollmentRequest.schema.js";

const parse = (contactPhone) => createEnrollmentRequestSchema.safeParse({ contactPhone });

describe("enrollment request contact phone (M05-13)", () => {
  it.each([
    ["0771234567", "0771234567"],
    ["077 123 4567", "0771234567"],
    ["077-123-4567", "0771234567"],
    ["+94 77 123 4567", "0771234567"],
    ["94771234567", "0771234567"],
  ])("accepts %s as %s", (input, normalised) => {
    const result = parse(input);
    expect(result.success).toBe(true);
    expect(result.data.contactPhone).toBe(normalised);
  });

  it.each(["call me pls", "12345", "077123456", "+1 202 555 0100"])("refuses %s", (input) => {
    expect(parse(input).success).toBe(false);
  });
});
