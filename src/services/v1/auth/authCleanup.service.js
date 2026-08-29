import * as authRepo from "../../../repositories/v1/auth/auth.repository.js";
import Logger from "../../../utils/logger.js";

export async function cleanupAuthArtifactsOnce() {
  const retentionDays = Number(process.env.AUTH_ARTIFACT_RETENTION_DAYS ?? 7);
  const batchSize = Number(process.env.AUTH_ARTIFACT_CLEANUP_BATCH_SIZE ?? 500);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000);
  return authRepo.cleanupExpiredAuthArtifacts(cutoff, batchSize);
}

export function scheduleAuthArtifactCleanup() {
  const intervalMs = Number(
    process.env.AUTH_ARTIFACT_CLEANUP_INTERVAL_MS ?? 3_600_000,
  );
  const run = () => {
    cleanupAuthArtifactsOnce()
      .then((result) => {
        if (result.total > 0) {
          Logger.info("Expired authentication artifacts removed", result);
        }
      })
      .catch((error) => {
        Logger.error("Authentication artifact cleanup failed", error);
      });
  };

  run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
