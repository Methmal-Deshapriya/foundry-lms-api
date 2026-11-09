import "dotenv/config";
import bcrypt from "bcryptjs";
import prisma from "../src/utils/prisma.js";

const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL?.trim().toLowerCase();
const password = process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD;

if (!email || !password || password.length < 8) {
  throw new Error(
    "Set BOOTSTRAP_SUPER_ADMIN_EMAIL and a BOOTSTRAP_SUPER_ADMIN_PASSWORD of at least 8 characters."
  );
}

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  // Anyone could have registered this address first, with a password only
  // they know. Taking the account over means: the password given here,
  // every old session ended, and a loud warning (code review M10-04).
  await prisma.user.update({
    where: { id: existing.id },
    data: {
      role: "SUPER_ADMIN",
      emailVerified: true,
      disabledAt: null,
      password: await bcrypt.hash(password, 10),
      securityVersion: { increment: 1 },
    },
  });
  console.warn(
    `WARNING: an account for ${email} already existed (role ${existing.role}, created ${existing.createdAt.toISOString()}).\n` +
      "It is now a SUPER_ADMIN with the BOOTSTRAP_SUPER_ADMIN_PASSWORD you set; its old password and every old session no longer work.\n" +
      "If you didn't create that account yourself, check the audit log for anything it did before today.",
  );
} else {
  await prisma.user.create({
    data: {
      firstName: process.env.BOOTSTRAP_SUPER_ADMIN_FIRST_NAME?.trim() || "Foundry",
      lastName: process.env.BOOTSTRAP_SUPER_ADMIN_LAST_NAME?.trim() || "Administrator",
      email,
      password: await bcrypt.hash(password, 10),
      role: "SUPER_ADMIN",
      emailVerified: true,
    },
  });
  console.log(`SUPER_ADMIN ${email} created.`);
}
