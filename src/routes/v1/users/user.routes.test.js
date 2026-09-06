import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import app from "../../../app.js";
import { generateToken } from "../../../utils/jwt.js";

vi.mock("../../../repositories/v1/users/user.repository.js", () => ({
  findUserById: vi.fn(async (id) => ({
    id,
    role: id.replace("test-", ""),
    emailVerified: true,
    securityVersion: 0,
  })),
}));

process.env.JWT_SECRET ||= "foundry-user-route-test";

function cookieFor(role) {
  return `token=${generateToken({ id: `test-${role}`, role, sv: 0, mfa: true })}`;
}

describe("User detail route access", () => {
  it("requires authentication", async () => {
    const response = await request(app).get(
      "/api/v1/users/90000000-0000-4000-8000-000000000001",
    );
    expect(response.status).toBe(401);
  });

  it("does not allow students to view another user's detail", async () => {
    const response = await request(app)
      .get("/api/v1/users/90000000-0000-4000-8000-000000000001")
      .set("Cookie", cookieFor("STUDENT"));
    expect(response.status).toBe(403);
  });

  it("allows admins through authorization before validating the id", async () => {
    const response = await request(app)
      .get("/api/v1/users/not-a-uuid")
      .set("Cookie", cookieFor("ADMIN"));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });

  it("allows super admins through authorization before validating the id", async () => {
    const response = await request(app)
      .get("/api/v1/users/not-a-uuid")
      .set("Cookie", cookieFor("SUPER_ADMIN"));
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
});
