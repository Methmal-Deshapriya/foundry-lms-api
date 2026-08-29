import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { loginLimiter } from "./rateLimiters.js";

describe("login abuse limiter", () => {
  it("does not count success but limits repeated failures", async () => {
    const app = express();
    app.use(express.json());
    app.post("/login", loginLimiter, (req, res) => {
      res.status(req.body.ok ? 200 : 401).json({ success: false });
    });

    await request(app)
      .post("/login")
      .send({ email: "student@example.com", ok: true })
      .expect(200);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(app)
        .post("/login")
        .send({ email: "student@example.com" })
        .expect(401);
    }
    const blocked = await request(app)
      .post("/login")
      .send({ email: "student@example.com" })
      .expect(429);
    expect(blocked.body).toMatchObject({
      success: false,
      code: "TOO_MANY_REQUESTS",
    });
  });
});
