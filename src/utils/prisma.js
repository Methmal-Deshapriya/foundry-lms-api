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
const prisma = usesAccelerate
  ? new PrismaClient({ ...clientOptions, accelerateUrl: databaseUrl }).$extends(
      withAccelerate(),
    )
  : new PrismaClient({
      ...clientOptions,
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });

export default prisma;
