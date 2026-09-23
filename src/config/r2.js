import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

let client;
let readinessCache;

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export function isR2Enabled() {
  return process.env.R2_ENABLED === "true";
}

export function getR2Config() {
  if (!isR2Enabled()) return null;
  const required = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_PUBLIC_BUCKET",
    "R2_PRIVATE_BUCKET",
    "R2_PUBLIC_BASE_URL",
  ];
  for (const name of required) {
    if (!process.env[name]?.trim()) throw new Error(`${name} is required when R2_ENABLED=true.`);
  }
  const publicBaseUrl = new URL(process.env.R2_PUBLIC_BASE_URL.trim());
  if (process.env.NODE_ENV === "production" && publicBaseUrl.protocol !== "https:") {
    throw new Error("R2_PUBLIC_BASE_URL must use HTTPS in production.");
  }
  return {
    accountId: process.env.R2_ACCOUNT_ID.trim(),
    accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(),
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim(),
    publicBucket: process.env.R2_PUBLIC_BUCKET.trim(),
    privateBucket: process.env.R2_PRIVATE_BUCKET.trim(),
    publicBaseUrl: publicBaseUrl.toString().replace(/\/$/, ""),
    uploadTtlSeconds: positiveInteger("R2_UPLOAD_URL_TTL_SECONDS", 300),
    downloadTtlSeconds: positiveInteger("R2_DOWNLOAD_URL_TTL_SECONDS", 300),
    readinessCacheMs: positiveInteger("R2_READINESS_CACHE_MS", 60_000),
  };
}

export function getR2Client() {
  const config = getR2Config();
  if (!config) throw new Error("Cloudflare R2 storage is not configured.");
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return client;
}

export function bucketForScope(scope) {
  const config = getR2Config();
  if (!config) throw new Error("Cloudflare R2 storage is not configured.");
  return scope === "PUBLIC" ? config.publicBucket : config.privateBucket;
}

export function publicObjectUrl(objectKey) {
  const config = getR2Config();
  if (!config) return null;
  return `${config.publicBaseUrl}/${objectKey.split("/").map(encodeURIComponent).join("/")}`;
}

export async function createUploadUrl({ scope, objectKey, contentType }) {
  const config = getR2Config();
  const command = new PutObjectCommand({
    Bucket: bucketForScope(scope),
    Key: objectKey,
    ContentType: contentType,
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: config.uploadTtlSeconds });
}

export async function inspectObject({ scope, objectKey }) {
  return getR2Client().send(
    new HeadObjectCommand({ Bucket: bucketForScope(scope), Key: objectKey }),
  );
}

export async function createDownloadUrl({ scope, objectKey, fileName }) {
  if (scope === "PUBLIC") return publicObjectUrl(objectKey);
  const config = getR2Config();
  const safeName = String(fileName ?? "download").replace(/[\r\n"\\]/g, "_");
  const command = new GetObjectCommand({
    Bucket: bucketForScope(scope),
    Key: objectKey,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
  });
  return getSignedUrl(getR2Client(), command, { expiresIn: config.downloadTtlSeconds });
}

export async function checkR2Readiness() {
  if (!isR2Enabled()) return "NOT_CONFIGURED";
  const config = getR2Config();
  if (readinessCache && Date.now() - readinessCache.checkedAt < config.readinessCacheMs) {
    if (readinessCache.error) throw readinessCache.error;
    return readinessCache.value;
  }
  try {
    await Promise.all([
      getR2Client().send(new HeadBucketCommand({ Bucket: config.publicBucket })),
      getR2Client().send(new HeadBucketCommand({ Bucket: config.privateBucket })),
    ]);
    readinessCache = { checkedAt: Date.now(), value: "UP", error: null };
    return "UP";
  } catch (error) {
    readinessCache = { checkedAt: Date.now(), value: null, error };
    throw error;
  }
}
