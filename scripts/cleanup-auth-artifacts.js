import "dotenv/config";
import { cleanupAuthArtifactsOnce } from "../src/services/v1/auth/authCleanup.service.js";
import { disconnectDatabase } from "../src/utils/prisma.js";

try {
  const result = await cleanupAuthArtifactsOnce();
  console.log(JSON.stringify(result));
} finally {
  await disconnectDatabase();
}
