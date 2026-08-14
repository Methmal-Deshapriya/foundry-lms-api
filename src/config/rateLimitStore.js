import { createClient } from "redis";
import { RedisStore } from "rate-limit-redis";
import Logger from "../utils/logger.js";

const redisUrl = process.env.RATE_LIMIT_REDIS_URL?.trim();
let client;
let connection;

if (redisUrl) {
  client = createClient({ url: redisUrl });
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

