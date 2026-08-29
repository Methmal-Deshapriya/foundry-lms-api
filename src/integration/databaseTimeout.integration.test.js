import { afterAll, describe, expect, it } from "vitest";
import {
  configuredStatementTimeoutMs,
  disconnectDatabase,
  runDatabaseTimeoutProbe,
} from "../utils/prisma.js";

const runIntegration = process.env.RUN_DATABASE_INTEGRATION === "1";

describe.skipIf(!runIntegration)("database statement timeout", () => {
  afterAll(async () => {
    await disconnectDatabase();
  });

  it("cancels a PostgreSQL statement near the configured upper bound", async () => {
    const startedAt = Date.now();
    await expect(
      runDatabaseTimeoutProbe(configuredStatementTimeoutMs / 1_000 + 5),
    ).rejects.toThrow(/statement timeout|canceling statement|connection terminated/i);
    expect(Date.now() - startedAt).toBeLessThan(configuredStatementTimeoutMs + 2_000);
  }, configuredStatementTimeoutMs + 5_000);
});
