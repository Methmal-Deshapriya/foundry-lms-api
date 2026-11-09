import * as authRepo from "../../../repositories/v1/auth/auth.repository.js";
import Logger from "../../../utils/logger.js";

export async function cleanupAuthArtifactsOnce() {
  const retentionDays = Number(process.env.AUTH_ARTIFACT_RETENTION_DAYS ?? 7);
  const batchSize = Number(process.env.AUTH_ARTIFACT_CLEANUP_BATCH_SIZE ?? 500);
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1_000);
  const artifacts = await authRepo.cleanupExpiredAuthArtifacts(cutoff, batchSize);
  // Sign-ups never verified within this many days are removed, so a
  // mistyped or squatted address doesn't keep someone's personal details
  // (or block the real owner) forever.
  const unverifiedRetentionDays = Number(process.env.UNVERIFIED_ACCOUNT_RETENTION_DAYS ?? 30);
  const unverifiedCutoff = new Date(Date.now() - unverifiedRetentionDays * 24 * 60 * 60 * 1_000);
  const unverifiedUsers = await authRepo.deleteStaleUnverifiedUsers(unverifiedCutoff, batchSize);
  return { ...artifacts, unverifiedUsers, total: artifacts.total + unverifiedUsers };
}

// Held off a few seconds past process start — running immediately races the
// database client's own connection/pool warmup (this was the other half of
// the P2028 cold-start failures fixed in auth.repository.js's cleanup
// query; harmless either way now that it's not an interactive transaction,
// but there's no reason to make it the very first query this process runs).
const FIRST_RUN_DELAY_MS = 5_000;

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

  const firstRunTimer = setTimeout(run, FIRST_RUN_DELAY_MS);
  firstRunTimer.unref();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => {
    clearTimeout(firstRunTimer);
    clearInterval(timer);
  };
}
