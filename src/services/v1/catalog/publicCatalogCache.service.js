import Logger from "../../../utils/logger.js";

const REVALIDATION_PATH = "/api/internal/catalog/revalidate";
const REQUEST_TIMEOUT_MS = 3000;

/**
 * Expires the Next.js public-catalog cache after a database write that changes
 * published catalog output. Cache invalidation is best-effort: the database
 * write remains successful if the frontend is temporarily unavailable, and
 * the normal five-minute cache lifetime provides the fallback.
 */
export async function revalidatePublicCatalogCache() {
  const clientUrl = process.env.CLIENT_URL?.replace(/\/$/, "");
  const secret = process.env.CATALOG_REVALIDATION_SECRET;

  if (!clientUrl || !secret) {
    Logger.warn("Public catalog cache revalidation is not configured.");
    return false;
  }

  try {
    const response = await fetch(`${clientUrl}${REVALIDATION_PATH}`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      Logger.warn("Public catalog cache revalidation was rejected.", {
        status: response.status,
      });
      return false;
    }

    return true;
  } catch (error) {
    Logger.warn("Public catalog cache revalidation failed.", {
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
