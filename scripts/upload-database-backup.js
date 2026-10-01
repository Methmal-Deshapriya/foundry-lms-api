// Uploads one database dump to the PRIVATE R2 bucket and prunes old ones,
// keeping the newest BACKUP_RETENTION_COUNT (default 14). Run by the daily
// .github/workflows/database-backup.yml job after pg_dump; also runnable by
// hand:  node scripts/upload-database-backup.js <path-to-dump-file>
//
// Environment: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_PRIVATE_BUCKET, and optionally BACKUP_PREFIX (default "backups/") and
// BACKUP_RETENTION_COUNT. See foundry_lms_docs/
// 2026-10-01_database_backup_and_restore_guide.md.
import "dotenv/config";
import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { DeleteObjectsCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const filePath = process.argv[2];
if (!filePath) throw new Error("Usage: node scripts/upload-database-backup.js <path-to-dump-file>");

const bucket = required("R2_PRIVATE_BUCKET");
const prefix = (process.env.BACKUP_PREFIX?.trim() || "backups/").replace(/^\/+/, "");
const keep = Number(process.env.BACKUP_RETENTION_COUNT ?? 14);
if (!Number.isInteger(keep) || keep < 1) throw new Error("BACKUP_RETENTION_COUNT must be a positive integer.");

const client = new S3Client({
  region: "auto",
  endpoint: `https://${required("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: required("R2_ACCESS_KEY_ID"), secretAccessKey: required("R2_SECRET_ACCESS_KEY") },
});

// Keys are named by UTC timestamp, so sorting them by name sorts them by age.
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const key = `${prefix}${stamp}${path.extname(filePath) || ".dump"}`;
const size = statSync(filePath).size;
if (size === 0) throw new Error("The dump file is empty — refusing to upload it.");

await client.send(
  new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: createReadStream(filePath),
    ContentLength: size,
    ContentType: "application/octet-stream",
  }),
);
console.log(`Uploaded ${key} (${(size / 1024).toFixed(1)} KB).`);

const keys = [];
let token;
do {
  const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
  for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
  token = page.IsTruncated ? page.NextContinuationToken : undefined;
} while (token);

const expired = keys.sort().reverse().slice(keep);
if (expired.length > 0) {
  await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: expired.map((Key) => ({ Key })) } }));
}
console.log(`Kept ${Math.min(keys.length, keep)} backup(s); deleted ${expired.length} older one(s).`);
