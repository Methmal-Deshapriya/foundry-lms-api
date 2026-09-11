import prisma from "../../../utils/prisma.js";

/**
 * User Activity Repository - The "Life Story"
 * Assembles a bounded "recent N + total" view of everything a single user
 * has done across the system, for the admin user detail page. Each section
 * is its own small query rather than one giant include, so the detail
 * request stays fast even for a long-lived account.
 */

const enrollmentInclude = {
  course: { include: { category: { include: { service: true } } } },
  intake: true,
  certificates: { where: { status: "ISSUED" }, orderBy: { issuedDate: "desc" }, take: 1 },
};

export async function findEnrollmentsForUser(userId, limit = 5) {
  const where = { userId };
  const [total, items] = await Promise.all([
    prisma.enrollment.count({ where }),
    prisma.enrollment.findMany({
      where,
      include: enrollmentInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
  ]);
  return { total, items };
}

export async function findManagedEnrollmentsForUser(userId, limit = 5) {
  const where = { enrolledByUserId: userId };
  const [total, items] = await Promise.all([
    prisma.enrollment.count({ where }),
    prisma.enrollment.findMany({
      where,
      include: { user: true, course: true, intake: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
    }),
  ]);
  return { total, items };
}

export async function findPaymentsRecordedByUser(userId, limit = 5) {
  const where = { recordedByUserId: userId };
  const [total, items] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: { course: true, intake: true, enrollment: { include: { user: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  return { total, items };
}

export async function findPaymentsForUser(userId, limit = 5) {
  const where = { enrollment: { userId } };
  const [total, items] = await Promise.all([
    prisma.payment.count({ where }),
    prisma.payment.findMany({
      where,
      include: { course: true, intake: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  return { total, items };
}

export async function findCertificatesForUser(userId, limit = 5) {
  const where = { enrollment: { userId } };
  const [total, items] = await Promise.all([
    prisma.certificate.count({ where }),
    prisma.certificate.findMany({ where, orderBy: { issuedDate: "desc" }, take: limit }),
  ]);
  return { total, items };
}

export async function findStudentProjectsForUser(userId, limit = 5) {
  const where = { userId };
  const [total, items] = await Promise.all([
    prisma.studentProject.count({ where }),
    prisma.studentProject.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
  ]);
  return { total, items };
}

export async function findEnrollmentRequestsForUser(userId, limit = 5) {
  const where = { studentUserId: userId };
  const [total, items] = await Promise.all([
    prisma.enrollmentRequest.count({ where }),
    prisma.enrollmentRequest.findMany({
      where,
      include: { course: true, intake: true },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  return { total, items };
}

export async function findAuditLogsForActor(userId, limit = 10) {
  const where = { actorUserId: userId };
  const [total, items] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: limit }),
  ]);
  return { total, items };
}
