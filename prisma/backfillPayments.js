// One-off backfill: synthesizes a Payment ledger row for every Enrollment
// that predates the payment ledger module (2026-08-30). Safe to re-run —
// it skips any enrollment that already has a payment row.
//
// Per the product decision made when this ran (the system had not yet
// gone to production, so there is no real-world ambiguity to preserve):
// historical COMPLETED enrollments are backfilled AS IF the one-time-payment
// discount always applied. If this is ever run against a database that
// *has* seen real production payments predating the ledger, revisit that
// assumption first — see `2026-08-30_payment_ledger_module_implementation_plan.md`
// §7 for the other option.
//
// Usage: node prisma/backfillPayments.js

import { Prisma } from "@prisma/client";
import prisma from "../src/utils/prisma.js";

async function main() {
  const enrollments = await prisma.enrollment.findMany({
    where: {
      paymentStatus: { in: ["COMPLETED", "PARTIAL"] },
      payments: { none: {} },
    },
    include: { course: { include: { courseGroup: true } } },
  });

  console.log(`Found ${enrollments.length} enrollment(s) needing a backfilled payment row.`);

  let created = 0;
  for (const enrollment of enrollments) {
    const price = new Prisma.Decimal(enrollment.course.price);
    const isFull = enrollment.paymentStatus === "COMPLETED";
    const discountAmount = isFull ? new Prisma.Decimal(enrollment.course.courseGroup.discountAmount) : new Prisma.Decimal(0);
    const amount = isFull ? price.minus(discountAmount) : price.dividedBy(2);

    await prisma.payment.create({
      data: {
        enrollmentId: enrollment.id,
        courseId: enrollment.courseId,
        amount,
        discountAmount,
        currency: enrollment.course.currency,
        type: isFull ? "FULL" : "PARTIAL",
        recordedByUserId: enrollment.enrolledByUserId,
        createdAt: enrollment.paymentCompletedAt ?? enrollment.createdAt,
      },
    });
    created += 1;
  }

  console.log(`Backfilled ${created} payment row(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
