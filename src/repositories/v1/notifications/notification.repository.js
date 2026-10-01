import prisma from "../../../utils/prisma.js";
import { handlePrismaError } from "../../../utils/Errors.js";

/**
 * Notifications & Promotions Repository.
 */

const liveWindow = (now) => ({
  AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }, { OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
});

// ---------------------------------------------------------------- audience

/** Where-clause for enrollments that put a student in this audience. */
export function audienceEnrollmentWhere({ audience, courseId, intakeId }) {
  const active = { status: { not: "CANCELLED" } };
  if (audience === "COURSE") return { ...active, courseId };
  if (audience === "INTAKE") return { ...active, intakeId };
  if (audience === "PARTIAL_PAYERS") {
    return { ...active, paymentStatus: "PARTIAL", ...(intakeId ? { intakeId } : courseId ? { courseId } : {}) };
  }
  return null; // ALL_STUDENTS
}

export function countAudience(target) {
  if (target.audience === "COURSE_INTEREST") {
    return prisma.user.count({ where: { role: "STUDENT", courseInterests: { some: { courseId: target.courseId } } } });
  }
  const enrollmentWhere = audienceEnrollmentWhere(target);
  return prisma.user.count({
    where: { role: "STUDENT", ...(enrollmentWhere ? { enrollments: { some: enrollmentWhere } } : {}) },
  });
}

/** Partial payers in scope, with what each still owes — for reminder emails. */
export function findPartialPayers({ courseId, intakeId }) {
  return prisma.enrollment.findMany({
    where: audienceEnrollmentWhere({ audience: "PARTIAL_PAYERS", courseId, intakeId }),
    select: {
      id: true,
      user: { select: { id: true, firstName: true, email: true, role: true } },
      course: { select: { title: true, price: true } },
      payments: { select: { amount: true } },
    },
  });
}

// ------------------------------------------------------------ admin: notifications

const adminNotificationInclude = {
  course: { select: { id: true, title: true } },
  intake: { select: { id: true, code: true } },
  createdBy: { select: { firstName: true, lastName: true } },
  _count: { select: { receipts: { where: { readAt: { not: null } } } } },
};

export async function findNotificationsPage({ status, q, limit, offset }) {
  const where = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { message: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({ where, include: adminNotificationInclude, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit, skip: offset }),
  ]);
  return { total, rows };
}

export function findNotificationById(id) {
  return prisma.notification.findUnique({ where: { id }, include: adminNotificationInclude });
}

export async function createNotification(data) {
  try {
    return await prisma.notification.create({ data, select: { id: true } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function updateNotification(id, data) {
  try {
    return await prisma.notification.update({ where: { id }, data, select: { id: true } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export function deleteNotification(id) {
  return prisma.notification.delete({ where: { id } });
}

// ------------------------------------------------------------ student: notifications

export function findStudentEnrollments(userId) {
  return prisma.enrollment.findMany({
    where: { userId, status: { not: "CANCELLED" } },
    select: {
      courseId: true,
      intakeId: true,
      paymentStatus: true,
      course: { select: { title: true, price: true } },
      payments: { select: { amount: true } },
    },
  });
}

export function findVisibleNotifications(userId, { courseIds, intakeIds, partialCourseIds, partialIntakeIds, interestCourseIds = [] }, now = new Date()) {
  const audienceMatch = [
    { audience: "ALL_STUDENTS" },
    ...(courseIds.length ? [{ audience: "COURSE", courseId: { in: courseIds } }] : []),
    ...(interestCourseIds.length ? [{ audience: "COURSE_INTEREST", courseId: { in: interestCourseIds } }] : []),
    ...(intakeIds.length ? [{ audience: "INTAKE", intakeId: { in: intakeIds } }] : []),
    ...(partialCourseIds.length
      ? [
          {
            audience: "PARTIAL_PAYERS",
            OR: [
              { courseId: null, intakeId: null },
              { intakeId: { in: partialIntakeIds } },
              { intakeId: null, courseId: { in: partialCourseIds } },
            ],
          },
        ]
      : []),
  ];
  return prisma.notification.findMany({
    where: {
      status: "PUBLISHED",
      ...liveWindow(now),
      OR: audienceMatch,
      NOT: { receipts: { some: { userId, dismissedAt: { not: null } } } },
    },
    include: {
      receipts: { where: { userId }, select: { readAt: true } },
      course: { select: { title: true } },
      intake: { select: { code: true } },
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: 50,
  });
}

export function upsertReceipt(notificationId, userId, data) {
  return prisma.notificationReceipt.upsert({
    where: { notificationId_userId: { notificationId, userId } },
    create: { notificationId, userId, ...data },
    update: data,
  });
}

export async function markManyRead(notificationIds, userId, now = new Date()) {
  if (notificationIds.length === 0) return;
  await prisma.$transaction(
    notificationIds.map((notificationId) =>
      prisma.notificationReceipt.upsert({
        where: { notificationId_userId: { notificationId, userId } },
        create: { notificationId, userId, readAt: now },
        update: { readAt: now },
      }),
    ),
  );
}

// ---------------------------------------------------------------- promotions

const promotionInclude = { imageObject: true, createdBy: { select: { firstName: true, lastName: true } } };

export async function findPromotionsPage({ status, q, limit, offset }) {
  const where = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ internalName: { contains: q, mode: "insensitive" } }, { headline: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.promotion.count({ where }),
    prisma.promotion.findMany({ where, include: promotionInclude, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit, skip: offset }),
  ]);
  return { total, rows };
}

export function findPromotionById(id) {
  return prisma.promotion.findUnique({ where: { id }, include: promotionInclude });
}

export function findActivePromotion(now = new Date()) {
  return prisma.promotion.findFirst({
    where: { status: "PUBLISHED", ...liveWindow(now) },
    include: { imageObject: true },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
  });
}

export async function createPromotion(data) {
  try {
    return await prisma.promotion.create({ data, select: { id: true } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function updatePromotion(id, data) {
  try {
    return await prisma.promotion.update({ where: { id }, data, select: { id: true } });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export function deletePromotion(id) {
  return prisma.promotion.delete({ where: { id } });
}

// ---------------------------------------------------------- course interest

export function findInterestCourseIds(userId) {
  return prisma.courseInterest.findMany({ where: { userId }, select: { courseId: true } });
}

export function findInterest(userId, courseId) {
  return prisma.courseInterest.findUnique({ where: { userId_courseId: { userId, courseId } } });
}

export function upsertInterest(userId, courseId) {
  return prisma.courseInterest.upsert({ where: { userId_courseId: { userId, courseId } }, create: { userId, courseId }, update: {} });
}

export function deleteInterest(userId, courseId) {
  return prisma.courseInterest.deleteMany({ where: { userId, courseId } });
}

export function countInterest(courseId) {
  return prisma.courseInterest.count({ where: { courseId, user: { role: "STUDENT" } } });
}

export function findPublishedCourseForInterest(courseId) {
  return prisma.course.findFirst({
    where: { id: courseId, status: "PUBLISHED", archivedAt: null },
    select: { id: true, title: true, slug: true, service: { select: { slug: true, status: true } } },
  });
}

/**
 * When an intake opens: archive any earlier "enrollment is open" notice for
 * the course, publish a fresh one to everyone interested, and mark them
 * notified — all in one transaction.
 */
export async function announceCourseOpen({ courseId, title, message, linkUrl, createdByUserId }) {
  return prisma.$transaction(async (transaction) => {
    await transaction.notification.updateMany({
      where: { audience: "COURSE_INTEREST", courseId, status: "PUBLISHED" },
      data: { status: "ARCHIVED" },
    });
    const now = new Date();
    const created = await transaction.notification.create({
      data: {
        title,
        message,
        audience: "COURSE_INTEREST",
        courseId,
        linkLabel: "Enroll now",
        linkUrl,
        pinned: true,
        status: "PUBLISHED",
        publishedAt: now,
        createdByUserId,
      },
      select: { id: true },
    });
    const { count } = await transaction.courseInterest.updateMany({ where: { courseId }, data: { notifiedAt: now } });
    return { id: created.id, notified: count };
  });
}
