import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import app from "../../../app.js";
import { generateToken } from "../../../utils/jwt.js";

vi.mock("../../../repositories/v1/users/user.repository.js", () => ({
  findUserById: vi.fn(async (id) => ({
    id,
    role: id.replace("test-", ""),
    emailVerified: true,
  })),
}));

process.env.JWT_SECRET ||= "foundry-session-library-route-test";

function cookieFor(role) {
  return `token=${generateToken({ id: `test-${role}`, role, mfa: true })}`;
}

describe("Session Library route access", () => {
  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/sessions");
    expect(response.status).toBe(401);
  });

  it("does not expose the library to students", async () => {
    const response = await request(app)
      .get("/api/v1/sessions")
      .set("Cookie", cookieFor("STUDENT"));
    expect(response.status).toBe(403);
  });

  it("allows admins through authorization before validating the request", async () => {
    const response = await request(app)
      .get("/api/v1/sessions?limit=0")
      .set("Cookie", cookieFor("ADMIN"));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("reserves permanent deletion for super admins", async () => {
    const response = await request(app)
      .delete("/api/v1/sessions/10000000-0000-4000-8000-000000000001")
      .set("Cookie", cookieFor("ADMIN"));
    expect(response.status).toBe(403);
  });
});
