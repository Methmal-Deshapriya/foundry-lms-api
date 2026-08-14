import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findUserById: vi.fn() }));
vi.mock("../repositories/v1/users/user.repository.js", () => ({
  findUserById: mocks.findUserById,
}));

import { authenticate } from "./authenticate.js";
import { generateToken } from "../utils/jwt.js";

describe("authenticate security claims", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "test-secret-with-at-least-32-bytes";
  });

  async function run(payload, user) {
    mocks.findUserById.mockResolvedValue(user);
    const req = { cookies: { token: generateToken(payload) } };
    const res = { set: vi.fn() };
    const next = vi.fn();
    await authenticate(req, res, next);
    return { req, res, next };
  }

  it("rejects a cookie issued before a security-version change", async () => {
    const { next } = await run(
      { id: "student-1", role: "STUDENT", sv: 0, mfa: false },
      { id: "student-1", role: "STUDENT", securityVersion: 1 },
    );
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it("rejects a privileged session without a completed MFA challenge", async () => {
    const { next } = await run(
      { id: "admin-1", role: "ADMIN", sv: 0, mfa: false },
      { id: "admin-1", role: "ADMIN", securityVersion: 0 },
    );
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 401 });
  });

  it("accepts a current MFA-verified administrator session", async () => {
    const { req, res, next } = await run(
      { id: "admin-1", role: "ADMIN", sv: 2, mfa: true },
      {
        id: "admin-1",
        role: "ADMIN",
        securityVersion: 2,
        emailVerified: true,
      },
    );
    expect(next).toHaveBeenCalledWith();
    expect(req.user).toMatchObject({ id: "admin-1", role: "ADMIN" });
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
  });
});
