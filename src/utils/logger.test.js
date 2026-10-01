import { afterEach, describe, expect, it, vi } from "vitest";
import Logger from "./logger.js";

afterEach(() => vi.restoreAllMocks());

const logged = (spy) => JSON.parse(spy.mock.calls[0][0]);

describe("logger never spreads unknown objects (M10-09)", () => {
  it("reduces an error to safe fields", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("Unique constraint failed\n{ password: \"$2b$10$hash\", phone: \"0771234567\" }"), {
      code: "P2002",
      meta: { target: ["email"], modelName: "User" },
      clientVersion: "7.9.1",
      password: "$2b$10$hash",
    });
    Logger.error("Saving the user failed", error);
    const entry = logged(spy);
    expect(entry).toMatchObject({ message: "Saving the user failed", errorName: "Error", errorCode: "P2002", errorTarget: ["email"], errorMessage: "Unique constraint failed" });
    expect(JSON.stringify(entry)).not.toContain("$2b$10$hash");
    expect(JSON.stringify(entry)).not.toContain("0771234567");
  });

  it("keeps simple metadata and drops nested objects", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    Logger.warn("Codes paused", { userId: "u-1", issued: 10, locked: true, user: { password: "x" } });
    expect(logged(spy)).toEqual(expect.objectContaining({ userId: "u-1", issued: 10, locked: true }));
    expect(logged(spy)).not.toHaveProperty("user");
  });
});
