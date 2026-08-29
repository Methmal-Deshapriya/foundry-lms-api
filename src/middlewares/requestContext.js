import crypto from "crypto";
import Logger from "../utils/logger.js";

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export function requestContext(req, res, next) {
  const incoming = req.get("x-request-id")?.trim();
  req.requestId = incoming && SAFE_REQUEST_ID.test(incoming)
    ? incoming
    : crypto.randomUUID();
  res.set("X-Request-Id", req.requestId);
  const startedAt = process.hrtime.bigint();

  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    Logger.info("HTTP request completed", {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
    });
  });
  next();
}
