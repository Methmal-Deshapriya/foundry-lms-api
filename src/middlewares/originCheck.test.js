import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { rejectForeignOrigins } from "./originCheck.js";
import { resendOtpLimiter } from "./rateLimiters.js";

function appWith(...middleware) {
  const app = express();
  app.use(express.json());
  app.use(...middleware);
  app.all("/thing", (req, res) => res.json({ success: true }));
  return app;
}

describe("foreign-origin guard (CSRF)", () => {
  const previous = process.env.CORS_ORIGIN;
  beforeEach(() => {
    process.env.CORS_ORIGIN = "https://foundryacademy.lk";
  });
  afterEach(() => {
    if (previous === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = previous;
  });

  it("refuses a state-changing request from another site", async () => {
    const response = await request(appWith(rejectForeignOrigins))
      .post("/thing")
      .set("Origin", "https://evil.example")
      .expect(403);
    expect(response.body.code).toBe("FORBIDDEN_ORIGIN");
  });

  it("allows our own site", async () => {
    await request(appWith(rejectForeignOrigins)).post("/thing").set("Origin", "https://foundryacademy.lk").expect(200);
  });

  it("allows requests without an Origin (scheduled jobs, curl)", async () => {
    await request(appWith(rejectForeignOrigins)).post("/thing").expect(200);
  });

  it("never blocks reads", async () => {
    await request(appWith(rejectForeignOrigins)).get("/thing").set("Origin", "https://evil.example").expect(200);
  });
});

describe("per-address resend limit", () => {
  it("counts each email separately, so one shared IP doesn't block a whole class", async () => {
    const app = appWith(resendOtpLimiter);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app).post("/thing").send({ email: "a@example.com" }).expect(200);
    }
    await request(app).post("/thing").send({ email: "A@Example.com " }).expect(429);
    await request(app).post("/thing").send({ email: "b@example.com" }).expect(200);
  });
});
