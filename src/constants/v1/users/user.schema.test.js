import { describe, expect, it } from "vitest";
import { userListQuerySchema } from "./user.schema.js";

describe("user list query validation", () => {
  it("bounds list size and offset", () => {
    expect(userListQuerySchema.safeParse({ limit: "1000000" }).success).toBe(false);
    expect(userListQuerySchema.safeParse({ limit: "abc" }).success).toBe(false);
    expect(userListQuerySchema.safeParse({ limit: "50", offset: "10" }).data)
      .toMatchObject({ limit: 50, offset: 10 });
  });
});
