import "dotenv/config";
import app from "./app.js";
import { validateRuntimeConfig } from "./config/runtimeConfig.js";
import {
  disconnectRateLimitStore,
  initializeRateLimitStore,
} from "./config/rateLimitStore.js";
import {
  disconnectDatabase,
  verifyDatabaseTimeoutPolicy,
} from "./utils/prisma.js";
import { checkEmailReadiness } from "./utils/email.js";
import { scheduleAuthArtifactCleanup } from "./services/v1/auth/authCleanup.service.js";
import Logger from "./utils/logger.js";

const PORT = process.env.PORT || 5000;
validateRuntimeConfig();
await initializeRateLimitStore();
if (process.env.NODE_ENV === "production") {
  await Promise.all([
    verifyDatabaseTimeoutPolicy(),
    checkEmailReadiness({ force: true }),
  ]);
}
const stopAuthCleanup = scheduleAuthArtifactCleanup();

const server = app.listen(PORT, () => {
  Logger.info("Foundry LMS API is accepting requests", { port: Number(PORT) });
});

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  Logger.info(`${signal} received; stopping new requests.`);
  stopAuthCleanup();

  const forceTimer = setTimeout(() => {
    Logger.error("Graceful shutdown deadline exceeded; exiting.");
    process.exit(1);
  }, 10_000);
  forceTimer.unref();

  server.close(async (error) => {
    try {
      if (error) throw error;
      await Promise.all([disconnectDatabase(), disconnectRateLimitStore()]);
      clearTimeout(forceTimer);
      process.exit(0);
    } catch (shutdownError) {
      Logger.error("Graceful shutdown failed", shutdownError);
      process.exit(1);
    }
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
