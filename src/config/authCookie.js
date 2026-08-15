export const AUTH_COOKIE_NAME = "token";

export function getAuthCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
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
