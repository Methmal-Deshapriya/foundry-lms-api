import { afterEach, describe, expect, it, vi } from "vitest";
import errorHandler from "./errorHandler.js";
import { ValidationError } from "../utils/Errors.js";

function run(err) {
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) };
  errorHandler(err, { method: "POST", path: "/api/v1/x", requestId: "req-1" }, res, vi.fn());
  return { status: res.status.mock.calls[0][0], body: json.mock.calls[0][0] };
}

afterEach(() => vi.restoreAllMocks());

describe("error handler (M10-08)", () => {
  it("passes a known error through", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = run(new ValidationError("Choose a course.", "courseId"));
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: "Choose a course.", field: "courseId" });
  });

  it("sends nothing of an unknown error: no details, field or own status", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const leaky = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:5432"), { statusCode: 418, details: { host: "10.0.0.5" }, field: "password" });
    const { status, body } = run(leaky);
    expect(status).toBe(500);
    expect(body).toEqual({ success: false, error: "Internal Server Error", code: "INTERNAL_SERVER_ERROR", requestId: "req-1" });
  });

  it("answers an oversized body with 413", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { status, body } = run(Object.assign(new Error("request entity too large"), { type: "entity.too.large", status: 413, statusCode: 413 }));
    expect(status).toBe(413);
    expect(body).toMatchObject({ code: "PAYLOAD_TOO_LARGE", error: "The request is too large." });
  });

  it("logs only the first line of the message (M10-09)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    run(new Error("Invalid `prisma.user.update()` invocation:\n{ data: { password: \"$2b$10$secret\" } }"));
    const logged = spy.mock.calls[0][0];
    expect(logged).toContain("Invalid `prisma.user.update()` invocation:");
    expect(logged).not.toContain("$2b$10$secret");
  });
});
