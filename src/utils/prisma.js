import { PrismaClient } from "@prisma/client";

/**
 * Standard Prisma Client Instance (Modern v7)
 * Centralizes database connectivity for the whole app.
 */
const prisma = new PrismaClient({
  // Global Omit API (Prisma 7.0+ GA)
  // This ensures the password field is NEVER returned in queries by default.
  // Security-first approach for Foundry LMS.
  omit: {
    user: {
      password: true,
    },
  },
});

export default prisma;
