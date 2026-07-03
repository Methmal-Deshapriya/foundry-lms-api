import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { withAccelerate } from "@prisma/extension-accelerate";

/**
 * Standard Prisma Client Instance (Modern v7)
 * Centralizes database connectivity for the whole app.
 */
const accelerateUrl = process.env.DATABASE_URL;
// const accelerateUrl = process.env.DIRECT_DATABASE_URL;

if (!accelerateUrl) {
  throw new Error("DATABASE_URL is missing in environment variables.");
}

const prisma = new PrismaClient({
  // Prisma Postgres / Accelerate URLs require this in client engine mode.
  accelerateUrl,
  // Global Omit API (Prisma 7.0+ GA)
  // This ensures the password field is NEVER returned in queries by default.
  // Security-first approach for Foundry LMS.
  omit: {
    user: {
      password: true,
    },
  },
}).$extends(withAccelerate());

export default prisma;
