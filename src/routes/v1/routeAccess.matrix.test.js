import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import YAML from "yaml";
import { describe, expect, it, vi } from "vitest";

// Every route's access rule, checked from the OpenAPI contract — the
// contract check (scripts/check-api-contract.js) already guarantees it lists
// exactly the Express routes, each with an x-access level. So a route added
// later is covered here automatically, and dropping a permission gate or
// moving a route above `router.use(authenticate)` fails this test.
//
// Only the *denials* are exercised (401 without a session, 403 for a role
// below the route's level), which are decided before any handler runs. The
// database client is replaced with one that throws on any use, so even a
// wrongly-open route can never read or write real data from here.

vi.mock("../../utils/prisma.js", () => {
  const refuse = new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") return undefined;
        throw new Error(`Route access test touched the database (prisma.${String(property)}).`);
      },
    },
  );
  return {
    default: refuse,
    checkDatabaseReadiness: vi.fn(),
    runDatabaseTimeoutProbe: vi.fn(),
    verifyDatabaseTimeoutPolicy: vi.fn(),
    disconnectDatabase: vi.fn(),
    databaseDeploymentMode: "DIRECT",
    configuredStatementTimeoutMs: 30_000,
  };
});

vi.mock("../../repositories/v1/users/user.repository.js", () => ({
  findUserById: vi.fn(async (id) => ({ id, role: id.replace("test-", ""), emailVerified: true, securityVersion: 0 })),
}));

process.env.JWT_SECRET ||= "foundry-route-access-matrix-test";

const { default: app } = await import("../../app.js");
const { generateToken } = await import("../../utils/jwt.js");

const contractPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../docs/api/openapi.yaml");
const contract = YAML.parse(fs.readFileSync(contractPath, "utf8"));
const HTTP_METHODS = ["get", "post", "put", "patch", "delete"];
const SAMPLE_ID = "90000000-0000-4000-8000-000000000099";

// Roles each access level must refuse with 403.
const DENIED_ROLES = {
  AUTHENTICATED: [],
  STUDENT: ["ADMIN", "SUPER_ADMIN"],
  ADMIN: ["STUDENT"],
  SUPER_ADMIN: ["STUDENT", "ADMIN"],
};

const operations = Object.entries(contract.paths).flatMap(([routePath, item]) =>
  HTTP_METHODS.filter((method) => item[method]).map((method) => ({
    method,
    routePath,
    url: routePath.replace(/\{[^}]+\}/g, SAMPLE_ID),
    access: item[method]["x-access"],
    operationId: item[method].operationId,
  })),
);

function cookieFor(role) {
  return `token=${generateToken({ id: `test-${role}`, role, sv: 0, mfa: true })}`;
}

const protectedOperations = operations.filter((operation) => operation.access !== "PUBLIC");
const roleDenials = protectedOperations.flatMap((operation) =>
  DENIED_ROLES[operation.access].map((role) => ({ ...operation, role })),
);

describe("route access matrix (from docs/api/openapi.yaml)", () => {
  it("covers the whole API", () => {
    expect(operations.length).toBeGreaterThan(100);
    expect(protectedOperations.length).toBeGreaterThan(80);
  });

  it.each(protectedOperations)("$method $routePath ($operationId) needs a session", async ({ method, url }) => {
    const response = await request(app)[method](url).send({});
    expect(response.status).toBe(401);
  });

  it.each(roleDenials)("$method $routePath ($operationId) refuses $role", async ({ method, url, role }) => {
    const response = await request(app)[method](url).set("Cookie", cookieFor(role)).send({});
    expect(response.status).toBe(403);
  });
});
