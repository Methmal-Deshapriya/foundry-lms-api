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
  if (!process.env.JWT_SECRET?.trim()) {
    throw new Error("JWT_SECRET is required.");
  }
  requireUrl("CLIENT_URL");
}
