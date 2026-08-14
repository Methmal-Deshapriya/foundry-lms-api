function requireUrl(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  try {
    return new URL(value).origin;
  } catch {
    throw new Error(`${name} must be a valid absolute URL.`);
  }
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
  const corsOrigin = requireUrl("CORS_ORIGIN");
  if (
    process.env.NODE_ENV === "production" &&
    (!clientOrigin.startsWith("https://") || !corsOrigin.startsWith("https://"))
  ) {
    throw new Error("CLIENT_URL and CORS_ORIGIN must use HTTPS in production.");
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
    ["DB_IDLE_TRANSACTION_TIMEOUT_MS", 15_000],
  ]) {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 1_000) {
      throw new Error(`${name} must be an integer of at least 1000ms.`);
    }
  }
}
