import { z } from "zod";

function isAllowedHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (
      process.env.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "::1"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export const secureHttpUrlSchema = z
  .string()
  .url("Invalid URL format")
  .refine(
    isAllowedHttpUrl,
    "Use an HTTPS URL. HTTP is allowed only for local development.",
  );

export const nullableSecureHttpUrlSchema = secureHttpUrlSchema
  .nullable()
  .optional();

/** The lower-cased hostname, or null when the value isn't a URL (never throws). */
export function hostnameOf(value) {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * An external image URL on one of the approved image hosts
 * (PROJECT_THUMBNAIL_HOSTS). The public site's CSP only loads images from
 * approved origins, so any other host would be blocked anyway
 * (code review M06-13).
 */
export const approvedImageUrlSchema = secureHttpUrlSchema
  .refine((value) => {
    const configuredHosts = (process.env.PROJECT_THUMBNAIL_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (configuredHosts.length === 0) return process.env.NODE_ENV !== "production";
    return configuredHosts.includes(hostnameOf(value));
  }, "The image must use an approved image host.")
  .nullable()
  .optional();

export const projectThumbnailUrlSchema = secureHttpUrlSchema
  .refine((value) => {
    const configuredHosts = (process.env.PROJECT_THUMBNAIL_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean);
    if (configuredHosts.length === 0) return process.env.NODE_ENV !== "production";
    return configuredHosts.includes(hostnameOf(value));
  }, "Thumbnail must use an approved image host.")
  .nullable()
  .optional();
