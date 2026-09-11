import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import app from "../../../app.js";
import { generateToken } from "../../../utils/jwt.js";
import { createLearningServiceService, listLearningServicesService } from "../../../services/v1/catalog/learningService.service.js";

vi.mock("../../../services/v1/catalog/learningService.service.js", () => ({
  listLearningServicesService: vi.fn().mockResolvedValue({
    services: [],
    pagination: { total: 0, limit: 50, offset: 0 },
  }),
  createLearningServiceService: vi.fn().mockResolvedValue({ id: "service-1", status: "DRAFT" }),
}));

vi.mock("../../../repositories/v1/users/user.repository.js", () => ({
  findUserById: vi.fn(async (id) => ({
    id,
    role: id.replace("test-", ""),
    emailVerified: true,
  })),
}));

process.env.JWT_SECRET ||= "foundry-service-summary-route-test";

function cookieFor(role, databaseRole = role) {
  return `token=${generateToken({ id: `test-${databaseRole}`, role, mfa: true })}`;
}

describe("Learning-service summary route access", () => {
  it("requires authentication", async () => {
    const response = await request(app).get("/api/v1/services/summary");
    expect(response.status).toBe(401);
  });

  it("rejects students", async () => {
    const response = await request(app)
      .get("/api/v1/services/summary")
      .set("Cookie", cookieFor("STUDENT"));
    expect(response.status).toBe(403);
  });

  it("uses the current database role instead of a stale privileged token role", async () => {
    const response = await request(app)
      .get("/api/v1/services/summary")
      .set("Cookie", cookieFor("ADMIN", "STUDENT"));

    expect(response.status).toBe(403);
  });

  it.each(["ADMIN", "SUPER_ADMIN"])(
    "allows %s accounts to read summaries",
    async (role) => {
      const response = await request(app)
        .get("/api/v1/services/summary")
        .set("Cookie", cookieFor(role));

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual({
        services: [],
        pagination: { total: 0, limit: 50, offset: 0 },
      });
      expect(listLearningServicesService).toHaveBeenCalled();
    },
  );

  it("lets admins view but not create learning services", async () => {
    const response = await request(app)
      .post("/api/v1/services")
      .set("Cookie", cookieFor("ADMIN"))
      .send({});
    expect(response.status).toBe(403);
    expect(createLearningServiceService).not.toHaveBeenCalled();
  });

  it("allows super admins to create a learning service", async () => {
    const body = {
      key: "CAREER_LABS",
      slug: "career-labs",
      title: "Career Labs",
      description: "Paid seasonal career labs for verified learners.",
      accessType: "PAID",
      courseMode: "SEASONAL",
      enrollmentMode: "ADMIN",
      paymentRequirement: "REQUIRED",
      sortOrder: 4,
    };
    const response = await request(app)
      .post("/api/v1/services")
      .set("Cookie", cookieFor("SUPER_ADMIN"))
      .send(body);
    expect(response.status).toBe(201);
    expect(createLearningServiceService).toHaveBeenCalledWith(body, "test-SUPER_ADMIN");
  });
});
