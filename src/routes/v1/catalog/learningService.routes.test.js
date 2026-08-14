import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import app from "../../../app.js";
import { generateToken } from "../../../utils/jwt.js";
import { getAdminLearningServiceSummariesService } from "../../../services/v1/catalog/learningServiceSummary.service.js";

vi.mock("../../../services/v1/catalog/learningServiceSummary.service.js", () => ({
  getAdminLearningServiceSummariesService: vi.fn().mockResolvedValue({
    services: [],
  }),
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
  return `token=${generateToken({ id: `test-${databaseRole}`, role })}`;
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
      expect(response.body.data).toEqual({ services: [] });
      expect(getAdminLearningServiceSummariesService).toHaveBeenCalled();
    },
  );
});
