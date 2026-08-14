import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { withAccelerate } from "@prisma/extension-accelerate";

/**
 * Standard Prisma Client Instance (Modern v7)
 * Centralizes database connectivity for the whole app.
 */
const databaseUrl = process.env.DATABASE_URL;
// const accelerateUrl = process.env.DIRECT_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing in environment variables.");
}

const clientOptions = {
  // Global Omit API (Prisma 7.0+ GA) ensures password hashes are never
  // returned unless an authentication query explicitly opts back in.
  omit: {
    user: {
      password: true,
    },
  },
};

const usesAccelerate = /^(prisma|prisma\+postgres):\/\//.test(databaseUrl);
const statementTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000);
const idleTransactionTimeoutMs = Number(
  process.env.DB_IDLE_TRANSACTION_TIMEOUT_MS ?? 15_000,
);
const prisma = usesAccelerate
  ? new PrismaClient({ ...clientOptions, accelerateUrl: databaseUrl }).$extends(
      withAccelerate(),
    )
  : new PrismaClient({
      ...clientOptions,
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        statement_timeout: statementTimeoutMs,
        query_timeout: statementTimeoutMs + 1_000,
        idle_in_transaction_session_timeout: idleTransactionTimeoutMs,
      }),
    });

export default prisma;
