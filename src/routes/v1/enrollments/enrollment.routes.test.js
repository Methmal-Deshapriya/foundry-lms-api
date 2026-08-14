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

process.env.JWT_SECRET ||= "foundry-enrollment-route-test";

function cookieFor(role) {
  return `token=${generateToken({ id: `test-${role}`, role })}`;
}

describe("Enrollment route access", () => {
  it("requires authentication for a batch roster", async () => {
    const response = await request(app).get(
      "/api/v1/batches/90000000-0000-4000-8000-000000000005/enrollments",
    );
    expect(response.status).toBe(401);
  });

  it("does not allow students to manually enroll another student", async () => {
    const response = await request(app)
      .post("/api/v1/batches/90000000-0000-4000-8000-000000000005/enrollments")
      .set("Cookie", cookieFor("STUDENT"))
      .send({ userId: "invalid" });
    expect(response.status).toBe(403);
  });

  it("allows admins through authorization before request validation", async () => {
    const response = await request(app)
      .post("/api/v1/batches/90000000-0000-4000-8000-000000000005/enrollments")
      .set("Cookie", cookieFor("ADMIN"))
      .send({ userId: "invalid" });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("VALIDATION_ERROR");
  });
});
