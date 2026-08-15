import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { withAccelerate } from "@prisma/extension-accelerate";
import pg from "pg";

const { Pool } = pg;

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
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL;
const poolConfig = (connectionString) => ({
  connectionString,
  statement_timeout: statementTimeoutMs,
  query_timeout: statementTimeoutMs + 1_000,
  idle_in_transaction_session_timeout: idleTransactionTimeoutMs,
  // Readiness promises a two-second dependency boundary, so connection
  // acquisition must never outlive that contract either.
  connectionTimeoutMillis: Math.min(statementTimeoutMs, 2_000),
  application_name: "foundry-lms-api",
});

const applicationPool = usesAccelerate ? null : new Pool(poolConfig(databaseUrl));
const probePool = usesAccelerate && directDatabaseUrl
  ? new Pool({ ...poolConfig(directDatabaseUrl), application_name: "foundry-lms-readiness" })
  : applicationPool;
const prisma = usesAccelerate
  ? new PrismaClient({ ...clientOptions, accelerateUrl: databaseUrl }).$extends(
      withAccelerate(),
    )
  : new PrismaClient({
      ...clientOptions,
      adapter: new PrismaPg(applicationPool, { disposeExternalPool: false }),
    });

export async function checkDatabaseReadiness(deadlineMs = 2_000) {
  if (!probePool) {
    throw new Error(
      "DIRECT_DATABASE_URL is required to probe an Accelerate deployment.",
    );
  }
  const client = await probePool.connect();
  let destroy = false;
  try {
    await client.query({
      text: `SET statement_timeout TO '${Math.min(deadlineMs, statementTimeoutMs)}ms'`,
      query_timeout: deadlineMs,
    });
    await client.query({ text: "SELECT 1", query_timeout: deadlineMs });
  } catch (error) {
    destroy = true;
    throw error;
  } finally {
    client.release(destroy);
  }
}

export async function runDatabaseTimeoutProbe(sleepSeconds) {
  if (!probePool) {
    throw new Error("A direct database URL is required for the timeout probe.");
  }
  const client = await probePool.connect();
  let destroy = false;
  try {
    await client.query(`SET statement_timeout TO '${statementTimeoutMs}ms'`);
    await client.query("SELECT pg_sleep($1)", [sleepSeconds]);
  } catch (error) {
    destroy = true;
    throw error;
  } finally {
    client.release(destroy);
  }
}

export async function verifyDatabaseTimeoutPolicy() {
  if (!probePool) {
    throw new Error("Database timeout policy cannot be verified without a direct URL.");
  }

  // Direct mode receives the same startup parameters as Prisma. Accelerate
  // must additionally be configured at the PostgreSQL role/database level,
  // because its remote connections do not use this local Pool configuration.
  if (usesAccelerate) {
    const verificationPool = new Pool({
      connectionString: directDatabaseUrl,
      connectionTimeoutMillis: 5_000,
      max: 1,
      application_name: "foundry-lms-timeout-verification",
    });
    try {
      const applicationRole = process.env.DB_APPLICATION_ROLE;
      const result = await verificationPool.query(
        "SELECT rolconfig FROM pg_roles WHERE rolname = $1",
        [applicationRole],
      );
      const settings = result.rows[0]?.rolconfig ?? [];
      if (!settings.some((setting) => setting.startsWith("statement_timeout="))) {
        throw new Error(
          `PostgreSQL statement_timeout is not configured for Accelerate role ${applicationRole}.`,
        );
      }
      if (
        !settings.some((setting) =>
          setting.startsWith("idle_in_transaction_session_timeout="),
        )
      ) {
        throw new Error(
          `PostgreSQL idle transaction timeout is not configured for Accelerate role ${applicationRole}.`,
        );
      }
    } finally {
      await verificationPool.end();
    }
  } else {
    const result = await probePool.query("SHOW statement_timeout");
    if (String(result.rows[0]?.statement_timeout ?? "0") === "0") {
      throw new Error("PostgreSQL statement_timeout is disabled.");
    }
  }
}

export async function disconnectDatabase() {
  await prisma.$disconnect();
  if (applicationPool) await applicationPool.end();
  if (probePool && probePool !== applicationPool) await probePool.end();
}

export const databaseDeploymentMode = usesAccelerate ? "ACCELERATE" : "DIRECT";
export const configuredStatementTimeoutMs = statementTimeoutMs;

export default prisma;
