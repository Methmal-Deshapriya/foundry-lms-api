export const AUTH_COOKIE_NAME = "token";

export function getAuthCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    // The API and the frontend live on different registrable domains in
    // production (onrender.com vs. foundryacademy.lk), which makes every
    // request genuinely cross-site — a "strict" (or even "lax") cookie is
    // never sent back on those, so every post-login request looked
    // unauthenticated even though login itself succeeded. "None" is the only
    // SameSite value browsers will actually send cross-site, and requires
    // `secure: true` to be accepted at all. Locally, frontend/backend differ
    // only by port (same site), so "lax" is fine and doesn't need HTTPS.
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    maxAge: 24 * 60 * 60 * 1000,
  };
}

export function getAuthCookieClearOptions() {
  const { maxAge: _maxAge, ...clearOptions } = getAuthCookieOptions();
  return clearOptions;
}

export function clearAuthCookie(res) {
  res.clearCookie(AUTH_COOKIE_NAME, getAuthCookieClearOptions());
}
