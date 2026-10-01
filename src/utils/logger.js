/**
 * Simple Logger Utility
 * In a real production app, this would use Winston or Pino.
 *
 * Never spreads an unknown object into a log line (code review M10-09): an
 * Error is reduced to its name, code, Prisma target, the first line of its
 * message and its stack; plain metadata keeps only simple values. A failing
 * Prisma call therefore can't print a password hash or personal fields.
 */
const MAX_TEXT = 500;

const clip = (value) => (typeof value === "string" && value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value);
const firstLine = (message) => clip(String(message ?? "").split("\n").find((line) => line.trim())?.trim() ?? "");

// A stack starts with the full message, which is exactly what must not be
// logged; keep only the "at ..." frames.
const stackFrames = (stack) =>
  typeof stack === "string" ? stack.split("\n").filter((frame) => frame.trim().startsWith("at ")).slice(0, 15).join("\n") : undefined;

function describeError(error) {
  return {
    errorName: error.name,
    errorCode: typeof error.code === "string" || typeof error.code === "number" ? error.code : undefined,
    errorTarget: Array.isArray(error.meta?.target) || typeof error.meta?.target === "string" ? error.meta.target : undefined,
    errorMessage: firstLine(error.message),
    stack: stackFrames(error.stack),
  };
}

// Plain metadata: strings, numbers, booleans and null only (an Error inside
// it is described the same safe way).
function safeMeta(meta) {
  if (!meta || typeof meta !== "object") return {};
  if (meta instanceof Error) return describeError(meta);
  const out = {};
  for (const [key, value] of Object.entries(meta)) {
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) out[key] = key === "stack" ? stackFrames(value) : clip(value);
    else if (value instanceof Error) out[key] = describeError(value);
    else if (Array.isArray(value) && value.every((item) => ["string", "number"].includes(typeof item))) out[key] = value.slice(0, 20);
  }
  return out;
}

const line = (level, message, meta) =>
  JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    message,
    ...safeMeta(meta),
  });

const Logger = {
  info: (message, meta = {}) => {
    console.log(line("INFO", message, meta));
  },
  error: (message, error = {}) => {
    console.error(line("ERROR", message, error));
  },
  warn: (message, meta = {}) => {
    console.warn(line("WARN", message, meta));
  },
};

export default Logger;
