import request from "supertest";
import { describe, expect, it } from "vitest";
import app from "../../../app.js";

describe("Postman artifact routes", () => {
  it("returns a directly importable collection without an API envelope", async () => {
    const response = await request(app).get("/api/postman/collection");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body.success).toBeUndefined();
    expect(response.body.info.schema).toContain("collection/v2.1.0");
    expect(
      response.body.variable.find(({ key }) => key === "baseUrl")?.value,
    ).toBeTruthy();
  });

  it("returns a directly importable safe environment", async () => {
    const response = await request(app).get("/api/postman/environment");

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.body._postman_variable_scope).toBe("environment");
    expect(
      response.body.values.find(
        ({ key }) => key === "allowDestructiveRequests",
      )?.value,
    ).toBe("false");
  });
});
