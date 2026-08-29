import "dotenv/config";
import pg from "pg";

const { Pool } = pg;
const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString || /^(prisma|prisma\+postgres):\/\//.test(connectionString)) {
  throw new Error("A direct PostgreSQL URL is required.");
}

const statementTimeoutMs = Number(process.env.DB_STATEMENT_TIMEOUT_MS ?? 30_000);
const idleTimeoutMs = Number(process.env.DB_IDLE_TRANSACTION_TIMEOUT_MS ?? 15_000);
const pool = new Pool({ connectionString, max: 1 });

try {
  const identity = await pool.query("SELECT current_user");
  const role = process.env.DB_APPLICATION_ROLE?.trim() || identity.rows[0].current_user;
  if (!/^[A-Za-z_][A-Za-z0-9_$.-]*$/.test(role)) {
    throw new Error("DB_APPLICATION_ROLE contains unsupported characters.");
  }
  const quotedRole = `"${String(role).replaceAll('"', '""')}"`;
  await pool.query(
    `ALTER ROLE ${quotedRole} SET statement_timeout TO '${statementTimeoutMs}ms'`,
  );
  await pool.query(
    `ALTER ROLE ${quotedRole} SET idle_in_transaction_session_timeout TO '${idleTimeoutMs}ms'`,
  );
  console.log(
    `Configured ${role}: statement_timeout=${statementTimeoutMs}ms, idle_in_transaction_session_timeout=${idleTimeoutMs}ms`,
  );
} finally {
  await pool.end();
}
