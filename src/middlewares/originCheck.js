import { getCorsOrigins } from "../config/runtimeConfig.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function allowedOrigins() {
  return process.env.CORS_ORIGIN ? getCorsOrigins() : ["http://localhost:3000"];
}

/**
 * CSRF guard (defence in depth next to the SameSite cookie).
 *
 * CORS only stops a foreign page from *reading* responses; a cross-site
 * <form method=POST> or no-cors fetch is still *sent*, with the cookie, and
 * body-less endpoints (publish, archive, enroll, logout) would run. Browsers
 * always attach an Origin header to those requests, so any state-changing
 * request whose Origin isn't one of ours is refused here.
 *
 * Requests with no Origin at all are let through: they come from non-browser
 * clients (the GitHub Actions jobs, curl, server-to-server), which don't
 * carry the user's cookie anyway.
 */
export function rejectForeignOrigins(req, res, next) {
  if (!UNSAFE_METHODS.has(req.method)) return next();
  const origin = req.get("origin");
  if (!origin || allowedOrigins().includes(origin)) return next();
  return res.status(403).json({
    success: false,
    error: "This request came from a site that isn't allowed to make changes here.",
    code: "FORBIDDEN_ORIGIN",
    requestId: req.requestId,
  });
}
