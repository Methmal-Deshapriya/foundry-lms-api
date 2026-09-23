function requireUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
}

/** CORS_ORIGIN allows more than one origin (e.g. localhost plus a forwarded
 * dev-tunnel URL) as a comma-separated list — this is the one place that
 * splits and normalizes it, shared by validation here and the cors
 * middleware in app.js so the two can never drift apart. */
export function getCorsOrigins() {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw) throw new Error("CORS_ORIGIN is required.");
  return raw.split(",").map((entry) => {
    const trimmed = entry.trim();
    try {
      return new URL(trimmed).origin;
    } catch {
      throw new Error(
        "CORS_ORIGIN must be a comma-separated list of valid absolute URLs.",
      );
    }
  });
}

/** Fail at process startup instead of discovering broken security or public
 * certificate configuration on the first affected request. */
export function validateRuntimeConfig() {
  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (!jwtSecret) {
    throw new Error("JWT_SECRET is required.");
  }
  if (Buffer.byteLength(jwtSecret, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 UTF-8 bytes.");
  }
  const clientOrigin = requireUrl("CLIENT_URL");
  const corsOrigins = getCorsOrigins();
  if (
    process.env.NODE_ENV === "production" &&
    (!clientOrigin.startsWith("https://") ||
      corsOrigins.some((origin) => !origin.startsWith("https://")))
  ) {
    throw new Error("CLIENT_URL and CORS_ORIGIN must use HTTPS in production.");
  }
  if (process.env.R2_ENABLED === "true") {
    for (const name of [
      "R2_ACCOUNT_ID",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "R2_PUBLIC_BUCKET",
      "R2_PRIVATE_BUCKET",
      "R2_PUBLIC_BASE_URL",
    ]) {
      if (!process.env[name]?.trim()) {
        throw new Error(`${name} is required when R2_ENABLED=true.`);
      }
    }
    const r2PublicUrl = requireUrl("R2_PUBLIC_BASE_URL");
    if (process.env.NODE_ENV === "production" && !r2PublicUrl.startsWith("https://")) {
      throw new Error("R2_PUBLIC_BASE_URL must use HTTPS in production.");
    }
  }
  if (process.env.NODE_ENV === "production") {
    for (const name of ["RESEND_API_KEY", "RESEND_FROM_EMAIL", "OTP_HMAC_KEYS"]) {
      if (!process.env[name]?.trim()) throw new Error(`${name} is required in production.`);
    }
    const otpKeys = process.env.OTP_HMAC_KEYS.split(",").map((key) => key.trim());
    if (
      otpKeys.some((entry) => {
        const separator = entry.indexOf(":");
        return separator < 1 || Buffer.byteLength(entry.slice(separator + 1), "utf8") < 32;
      })
    ) {
      throw new Error(
        "OTP_HMAC_KEYS must contain comma-separated version:secret entries with secrets of at least 32 bytes.",
      );
    }
    if (/^(prisma|prisma\+postgres):\/\//.test(process.env.DATABASE_URL ?? "")) {
      if (!process.env.DIRECT_DATABASE_URL?.trim()) {
        throw new Error(
          "DIRECT_DATABASE_URL is required to verify readiness for Accelerate deployments.",
        );
      }
      if (process.env.DB_TIMEOUTS_MANAGED_EXTERNALLY !== "true") {
        throw new Error(
          "DB_TIMEOUTS_MANAGED_EXTERNALLY=true is required for Accelerate after configuring PostgreSQL role-level timeouts.",
        );
      }
      if (!process.env.DB_APPLICATION_ROLE?.trim()) {
        throw new Error(
          "DB_APPLICATION_ROLE is required to verify Accelerate role-level timeouts.",
        );
      }
    }
  }
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.PROJECT_THUMBNAIL_HOSTS?.trim()
  ) {
    throw new Error("PROJECT_THUMBNAIL_HOSTS is required in production.");
  }
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 0);
  if (!Number.isInteger(trustProxyHops) || trustProxyHops < 0) {
    throw new Error("TRUST_PROXY_HOPS must be a non-negative integer.");
  }
  const instanceCount = Number(process.env.API_INSTANCE_COUNT ?? 1);
  if (!Number.isInteger(instanceCount) || instanceCount < 1) {
    throw new Error("API_INSTANCE_COUNT must be a positive integer.");
  }
  if (
    process.env.NODE_ENV === "production" &&
    instanceCount > 1 &&
    !process.env.RATE_LIMIT_REDIS_URL?.trim()
  ) {
    throw new Error(
      "RATE_LIMIT_REDIS_URL is required for multiple production API instances.",
    );
  }
  for (const [name, fallback] of [
    ["DB_STATEMENT_TIMEOUT_MS", 30_000],
    ["DB_CONNECTION_TIMEOUT_MS", 2_000],
    ["DB_IDLE_TRANSACTION_TIMEOUT_MS", 30_000],
    ["DB_INTERACTIVE_TRANSACTION_TIMEOUT_MS", 15_000],
    ["DB_INTERACTIVE_TRANSACTION_MAX_WAIT_MS", 5_000],
  ]) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1_000) {
      throw new Error(`${name} must be an integer of at least 1000ms.`);
    }
  }
  const idleTransactionTimeoutMs = Number(
    process.env.DB_IDLE_TRANSACTION_TIMEOUT_MS ?? 30_000,
  );
  const interactiveTransactionTimeoutMs = Number(
    process.env.DB_INTERACTIVE_TRANSACTION_TIMEOUT_MS ?? 15_000,
  );
  if (
    /^(prisma|prisma\+postgres):\/\//.test(process.env.DATABASE_URL ?? "") &&
    interactiveTransactionTimeoutMs > 15_000
  ) {
    throw new Error(
      "DB_INTERACTIVE_TRANSACTION_TIMEOUT_MS cannot exceed Prisma Accelerate's 15000ms limit.",
    );
  }
  if (interactiveTransactionTimeoutMs >= idleTransactionTimeoutMs) {
    throw new Error(
      "DB_INTERACTIVE_TRANSACTION_TIMEOUT_MS must be lower than DB_IDLE_TRANSACTION_TIMEOUT_MS.",
    );
  }
  for (const [name, fallback] of [
    ["EMAIL_READINESS_CACHE_MS", 60_000],
    ["AUTH_ARTIFACT_CLEANUP_INTERVAL_MS", 3_600_000],
    ["AUTH_ARTIFACT_CLEANUP_BATCH_SIZE", 500],
    ["AUTH_ARTIFACT_RETENTION_DAYS", 7],
    ["RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS", 2_000],
    ["R2_UPLOAD_URL_TTL_SECONDS", 300],
    ["R2_DOWNLOAD_URL_TTL_SECONDS", 300],
    ["R2_READINESS_CACHE_MS", 60_000],
    ["R2_MAX_IMAGE_BYTES", 10_485_760],
    ["R2_MAX_MATERIAL_BYTES", 104_857_600],
    ["R2_MAX_RECORDING_BYTES", 5_368_709_120],
    ["R2_MAX_PROJECT_THUMBNAIL_BYTES", 5_242_880],
  ]) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} must be a positive integer.`);
    }
  }
}
