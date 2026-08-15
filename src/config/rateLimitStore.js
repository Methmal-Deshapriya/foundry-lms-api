import { createClient } from "redis";
import { RedisStore } from "rate-limit-redis";
import Logger from "../utils/logger.js";

const redisUrl = process.env.RATE_LIMIT_REDIS_URL?.trim();
let client;
let connection;

if (redisUrl) {
  const connectTimeout = Number(
    process.env.RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS ?? 2_000,
  );
  client = createClient({
    url: redisUrl,
    socket: {
      connectTimeout,
      reconnectStrategy: (retries) =>
        retries >= 3
          ? new Error("Rate-limit Redis is unavailable after 3 retries.")
          : Math.min(100 * 2 ** retries, 1_000),
    },
  });
  client.on("error", (error) => Logger.error("Rate-limit Redis error", error));
  connection = client.connect();
}

export function createRateLimitStore(prefix) {
  if (!client) return undefined;
  return new RedisStore({
    prefix: `foundry-lms:${prefix}:`,
    sendCommand: async (...args) => {
      await connection;
      return client.sendCommand(args);
    },
  });
}

export async function initializeRateLimitStore() {
  if (connection) await connection;
}

export async function checkRateLimitStoreReadiness() {
  if (!client) return "NOT_CONFIGURED";
  await connection;
  await client.ping();
  return "UP";
}

export async function disconnectRateLimitStore() {
  if (client?.isOpen) await client.quit();
}
