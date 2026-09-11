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
  await prisma.user.update({
    where: { id: existing.id },
    data: { role: "SUPER_ADMIN", emailVerified: true },
  });
  console.log(`Existing user ${email} promoted to SUPER_ADMIN.`);
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
