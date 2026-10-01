export const AUTH_COOKIE_NAME = "token";

export const AUTH_COOKIE_SAME_SITE_VALUES = new Set(["lax", "strict", "none"]);

// "lax" by default everywhere. Production must serve the site and the API
// from one registrable domain (e.g. foundryacademy.lk + api.foundryacademy.lk,
// see the deployment requirements doc), which makes them same-site, so a
// "lax" cookie is sent on every request the app makes while cross-site pages
// can't use it to fire POSTs (CSRF). Only if the API is ever hosted on a
// different domain (e.g. *.onrender.com) does this need
// AUTH_COOKIE_SAME_SITE=none, which also needs HTTPS (secure).
export function getAuthCookieSameSite() {
  const configured = process.env.AUTH_COOKIE_SAME_SITE?.trim().toLowerCase();
  return configured && AUTH_COOKIE_SAME_SITE_VALUES.has(configured) ? configured : "lax";
}

export function getAuthCookieOptions() {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: getAuthCookieSameSite(),
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
