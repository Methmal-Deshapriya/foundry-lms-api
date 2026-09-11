/**
 * Serialize application-level invariants inside the current PostgreSQL
 * transaction. The outer SELECT avoids exposing PostgreSQL's `void` return
 * type through Prisma's driver adapter.
 */
export async function acquireTransactionLock(transaction, key) {
  await transaction.$queryRawUnsafe(
    "SELECT 1 AS acquired FROM (SELECT pg_advisory_xact_lock(hashtext($1))) AS lock",
    key,
  );
}

