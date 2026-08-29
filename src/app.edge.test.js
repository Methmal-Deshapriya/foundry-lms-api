import { describe, expect, it } from "vitest";
import request from "supertest";
import app from "./app.js";

describe("API edge envelopes", () => {
  it("returns JSON for unknown routes with a correlation ID", async () => {
    const response = await request(app).get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      success: false,
      code: "ROUTE_NOT_FOUND",
    });
    expect(response.headers["x-request-id"]).toEqual(expect.any(String));
    expect(response.body.requestId).toBe(response.headers["x-request-id"]);
  });

  it("returns a stable 400 JSON envelope for malformed JSON", async () => {
    const response = await request(app)
      .post("/api/v1/auth/login")
      .set("Origin", "http://localhost:3000")
      .set("Content-Type", "application/json")
      .send('{"email":');
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      success: false,
      code: "MALFORMED_JSON",
    });
    expect(response.headers["access-control-allow-origin"]).toBe(
      "http://localhost:3000",
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
