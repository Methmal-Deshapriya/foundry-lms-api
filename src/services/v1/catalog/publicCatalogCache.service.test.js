import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Logger from "../../../utils/logger.js";
import { revalidatePublicCatalogCache } from "./publicCatalogCache.service.js";

const originalClientUrl = process.env.CLIENT_URL;
const originalSecret = process.env.CATALOG_REVALIDATION_SECRET;

describe("public catalog cache revalidation", () => {
  beforeEach(() => {
    process.env.CLIENT_URL = "http://localhost:3000/";
    process.env.CATALOG_REVALIDATION_SECRET = "test-secret";
    vi.spyOn(Logger, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalClientUrl === undefined) delete process.env.CLIENT_URL;
    else process.env.CLIENT_URL = originalClientUrl;
    if (originalSecret === undefined) delete process.env.CATALOG_REVALIDATION_SECRET;
    else process.env.CATALOG_REVALIDATION_SECRET = originalSecret;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("calls the protected Next.js invalidation endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchMock);

    await expect(revalidatePublicCatalogCache()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3000/api/internal/catalog/revalidate",
      expect.objectContaining({
        method: "POST",
        headers: { authorization: "Bearer test-secret" },
      }),
    );
  });

  it("does not make a request when the shared secret is missing", async () => {
    delete process.env.CATALOG_REVALIDATION_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(revalidatePublicCatalogCache()).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the catalog write successful when invalidation is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );

    await expect(revalidatePublicCatalogCache()).resolves.toBe(false);
    expect(Logger.warn).toHaveBeenCalled();
  });
});
