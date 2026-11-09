import prisma from "../../../utils/prisma.js";
import { BALANCE_PAYMENT_SELECT } from "../../../utils/paymentBalance.js";
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
      agreedPrice: true,
      payments: { select: BALANCE_PAYMENT_SELECT },
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

// Live counts per status for the filter pills, with the search applied but
// not the status (code review M09-10).
async function statusSummary(model, searchWhere) {
  const groups = await model.groupBy({ by: ["status"], where: searchWhere, _count: { _all: true } });
  const count = (status) => groups.find((group) => group.status === status)?._count._all ?? 0;
  const summary = { draft: count("DRAFT"), published: count("PUBLISHED"), archived: count("ARCHIVED") };
  return { all: summary.draft + summary.published + summary.archived, ...summary };
}

export async function findNotificationsPage({ status, q, limit, offset }) {
  const searchWhere = q ? { OR: [{ title: { contains: q, mode: "insensitive" } }, { message: { contains: q, mode: "insensitive" } }] } : {};
  const where = { ...searchWhere, ...(status ? { status } : {}) };
  const [total, rows, summary] = await Promise.all([
    prisma.notification.count({ where }),
    prisma.notification.findMany({ where, include: adminNotificationInclude, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit, skip: offset }),
    statusSummary(prisma.notification, searchWhere),
  ]);
  return { total, rows, summary };
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

/** A changed title or message is new to everyone: clear "read", keep dismissals (M09-04). */
export function resetReads(notificationId) {
  return prisma.notificationReceipt.updateMany({ where: { notificationId, readAt: { not: null } }, data: { readAt: null } });
}

// ---------------------------------------------------------- reminder emails

const SEND_CLAIM_TTL_MS = 15 * 60_000;

/**
 * Claim the right to email this notification (code review M09-01). Only one
 * send runs at a time; a claim left by a crashed send expires after 15 min.
 */
export async function claimEmailSend(id, now = new Date()) {
  const { count } = await prisma.notification.updateMany({
    where: { id, OR: [{ emailSendingAt: null }, { emailSendingAt: { lt: new Date(now.getTime() - SEND_CLAIM_TTL_MS) } }] },
    data: { emailSendingAt: now },
  });
  return count === 1;
}

export function releaseEmailSend(id) {
  return prisma.notification.update({ where: { id }, data: { emailSendingAt: null }, select: { id: true } });
}

/** Students this reminder has already been emailed to. */
export async function findEmailedUserIds(notificationId) {
  const rows = await prisma.notificationReceipt.findMany({ where: { notificationId, emailedAt: { not: null } }, select: { userId: true } });
  return rows.map((row) => row.userId);
}

export function markEmailed(notificationId, userId, now = new Date()) {
  return prisma.notificationReceipt.upsert({
    where: { notificationId_userId: { notificationId, userId } },
    create: { notificationId, userId, emailedAt: now },
    update: { emailedAt: now },
  });
}

export function countEmailed(notificationId) {
  return prisma.notificationReceipt.count({ where: { notificationId, emailedAt: { not: null } } });
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
      agreedPrice: true,
      payments: { select: BALANCE_PAYMENT_SELECT },
    },
  });
}

export function findVisibleNotifications(userId, { courseIds, intakeIds, partialCourseIds, partialIntakeIds, interests = [] }, now = new Date()) {
  const audienceMatch = [
    { audience: "ALL_STUDENTS" },
    ...(courseIds.length ? [{ audience: "COURSE", courseId: { in: courseIds } }] : []),
    // An "enrollment is open" notice goes to students who asked before it
    // was published, not to ones who pressed "Notify me" afterwards
    // (code review M09-03).
    ...interests.map((interest) => ({ audience: "COURSE_INTEREST", courseId: interest.courseId, publishedAt: { gte: interest.createdAt } })),
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
      // Dismissed notifications are hidden, except payment reminders, which
      // can't be dismissed (decided 2026-10-01; code review M09-04).
      NOT: { audience: { not: "PARTIAL_PAYERS" }, receipts: { some: { userId, dismissedAt: { not: null } } } },
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
  const searchWhere = q ? { OR: [{ internalName: { contains: q, mode: "insensitive" } }, { headline: { contains: q, mode: "insensitive" } }] } : {};
  const where = { ...searchWhere, ...(status ? { status } : {}) };
  const [total, rows, summary] = await Promise.all([
    prisma.promotion.count({ where }),
    prisma.promotion.findMany({ where, include: promotionInclude, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: limit, skip: offset }),
    statusSummary(prisma.promotion, searchWhere),
  ]);
  return { total, rows, summary };
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
  return prisma.courseInterest.findMany({ where: { userId }, select: { courseId: true, createdAt: true } });
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
