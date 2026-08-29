import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const { Client } = pg;
const action = process.argv[2];
const schema = process.env.MIGRATION_TEST_SCHEMA;
const connectionString = process.env.DIRECT_DATABASE_URL;

if (!connectionString) throw new Error("DIRECT_DATABASE_URL is required.");
if (!schema || !/^codex_verify_[a-z0-9_]{3,48}$/.test(schema)) {
  throw new Error("MIGRATION_TEST_SCHEMA must use the codex_verify_ prefix and safe lowercase characters.");
}
if (!["apply", "drop"].includes(action)) {
  throw new Error("Use apply or drop.");
}

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const client = new Client({ connectionString, application_name: "foundry-lms-migration-verifier" });

await client.connect();
try {
  if (action === "drop") {
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    console.log(`Removed isolated schema ${schema}.`);
  } else {
    await client.query(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schema)} CASCADE`);
    await client.query(`CREATE SCHEMA ${quoteIdentifier(schema)}`);
    await client.query(`SET search_path TO ${quoteIdentifier(schema)}, public`);

    const migrationRoot = path.resolve("prisma", "migrations");
    const entries = (await fs.readdir(migrationRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const sql = await fs.readFile(path.join(migrationRoot, entry.name, "migration.sql"), "utf8");
      await client.query(sql);
      console.log(`Applied ${entry.name}.`);
    }
    console.log(`Applied ${entries.length} migrations to isolated schema ${schema}.`);
  }
} finally {
  await client.end();
}
