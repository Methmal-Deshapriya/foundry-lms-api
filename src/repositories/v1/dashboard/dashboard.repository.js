import prisma from "../../../utils/prisma.js";
import { findProgressForEnrollments, visibleCourseSessionWhere } from "../enrollments/enrollment.repository.js";
import { findVisibleSessions } from "../learning/classroom.repository.js";

/**
 * Dashboard Repository - The "Front Page"
 * Small, bounded aggregate queries for the two role-specific dashboards.
 * Each is a handful of counts (or a short recent list) run in parallel —
 * no per-row N+1 work, so this stays fast regardless of platform size.
 */

const HEATMAP_DAYS = 364; // 52 weeks (full year) — still one small, cheap, single-user query

export async function getStudentSummary(userId) {
  const [coursesEnrolled, coursesCompleted, certificatesEarned, recentEnrollments, heatmapCompletions, issuedCertificates, reviewedProjects] =
    await Promise.all([
      prisma.enrollment.count({ where: { userId, status: { not: "CANCELLED" } } }),
      prisma.enrollment.count({ where: { userId, status: "COMPLETED" } }),
      prisma.certificate.count({ where: { enrollment: { userId }, status: "ISSUED" } }),
      prisma.enrollment.findMany({
        where: { userId, status: { not: "CANCELLED" } },
        orderBy: { updatedAt: "desc" },
        // Raised from 5: the "your courses" list below is now an internally
        // scrollable panel on the client, so it can afford to show more.
        take: 10,
        select: {
          id: true,
          intakeId: true,
          status: true,
          updatedAt: true,
          course: {
            select: {
              title: true,
              thumbnailUrl: true,
              thumbnailObject: { select: { status: true, objectKey: true } },
            },
          },
          intake: { select: { code: true } },
        },
      }),
      // Learning-activity heatmap: one bounded query over a single user's
      // own completions in the last 12 weeks (a handful of rows at most),
      // grouped by day in JS below — cheap, and the one thing session
      // completions are uniquely suited to show that nothing else captures.
      prisma.sessionCompletion.findMany({
        where: {
          enrollment: { userId },
          completedAt: { gte: (() => {
            const since = new Date();
            since.setUTCDate(since.getUTCDate() - (HEATMAP_DAYS - 1));
            since.setUTCHours(0, 0, 0, 0);
            return since;
          })() },
        },
        select: { completedAt: true },
      }),
      // Recent activity feed: derived from data we already have elsewhere
      // (no notifications table — a real one would need triggers/read-state
      // for little added value here), each source capped small.
      prisma.certificate.findMany({
        where: { enrollment: { userId }, status: "ISSUED" },
        orderBy: { issuedDate: "desc" },
        take: 3,
        select: { id: true, courseName: true, issuedDate: true },
      }),
      prisma.studentProject.findMany({
        where: { userId, status: { in: ["APPROVED", "REJECTED"] }, reviewedAt: { not: null } },
        orderBy: { reviewedAt: "desc" },
        take: 3,
        select: { id: true, title: true, status: true, reviewedAt: true },
      }),
    ]);

  const countsByDate = new Map();
  for (const { completedAt } of heatmapCompletions) {
    const key = completedAt.toISOString().slice(0, 10);
    countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
  }
  const heatmap = Array.from(countsByDate, ([date, count]) => ({ date, count }));

  const recentActivity = [
    ...issuedCertificates.map((certificate) => ({
      type: "CERTIFICATE_ISSUED",
      occurredAt: certificate.issuedDate,
      title: certificate.courseName,
    })),
    ...reviewedProjects.map((project) => ({
      type: project.status === "APPROVED" ? "PROJECT_APPROVED" : "PROJECT_REJECTED",
      occurredAt: project.reviewedAt,
      title: project.title,
    })),
    ...recentEnrollments
      .filter((enrollment) => enrollment.status === "COMPLETED")
      .map((enrollment) => ({
        type: "COURSE_COMPLETED",
        occurredAt: enrollment.updatedAt,
        title: enrollment.course?.title ?? null,
      })),
  ]
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 5);

  // Reuses the exact same batched "visible session" progress lookup the My
  // Courses list already relies on (see enrollment.repository.js) — same
  // shape, same visibility rules, no separate N+1 query per card here either.
  const progressByEnrollment = await findProgressForEnrollments(recentEnrollments);

  // "Continue learning": the next not-yet-completed session for whichever
  // enrollment was most recently active (recentEnrollments[0], since that
  // list is already sorted by updatedAt desc). One extra query, scoped to
  // a single enrollment — not run per row, so this stays cheap regardless
  // of how many courses the student is in.
  let continueLearning = null;
  const topEnrollment = recentEnrollments[0]?.status === "ACTIVE" ? recentEnrollments[0] : null;
  if (topEnrollment) {
    const sessions = await findVisibleSessions(topEnrollment.intakeId, topEnrollment.id);
    const nextSession = sessions.find((row) => !(row.completions?.length > 0));
    if (nextSession) {
      continueLearning = {
        enrollmentId: topEnrollment.id,
        courseTitle: topEnrollment.course?.title ?? null,
        sessionTitle: nextSession.session.title,
        orderIndex: nextSession.orderIndex ?? nextSession.historicalOrderIndex ?? null,
      };
    }
  }

  return {
    coursesEnrolled,
    coursesCompleted,
    certificatesEarned,
    recentEnrollments,
    progressByEnrollment,
    continueLearning,
    heatmap,
    recentActivity,
  };
}

const DEFAULT_TREND_MONTHS = 6;
const MAX_TREND_MONTHS = 24; // guards a wide-open custom range from seeding an unbounded bucket list

// "yyyy-MM" bucket key in UTC — matches how the buckets below are seeded,
// so a row's key always finds its pre-built bucket regardless of timezone.
function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthsBetween(from, to) {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1;
}

// Every month between `from` and `to` (inclusive, oldest first), pre-seeded
// so a month with zero rows still shows up as a zero bar instead of a gap.
function seedMonthBuckets(from, to) {
  const count = Math.min(MAX_TREND_MONTHS, Math.max(1, monthsBetween(from, to)));
  const buckets = [];
  const cursor = new Date(to);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  for (let i = count - 1; i >= 0; i--) {
    const date = new Date(cursor);
    date.setUTCMonth(date.getUTCMonth() - i);
    buckets.push({ key: monthKey(date), label: date.toLocaleString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" }) });
  }
  return buckets;
}

// Either an explicit custom range (`from`/`to`, from the calendar picker) or
// a preset lookback window (`months` — 3/6/12 from the filter pills),
// never both; `months` is the fallback when neither date is given.
function resolveTrendWindow({ months, from, to } = {}) {
  if (from || to) {
    const start = from ? new Date(from) : new Date(to);
    const end = to ? new Date(to) : new Date();
    start.setUTCHours(0, 0, 0, 0);
    end.setUTCHours(23, 59, 59, 999);
    return { start, end };
  }
  const resolvedMonths = Math.min(MAX_TREND_MONTHS, Math.max(1, months ?? DEFAULT_TREND_MONTHS));
  const end = new Date();
  const start = new Date();
  start.setUTCMonth(start.getUTCMonth() - (resolvedMonths - 1));
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  return { start, end };
}

const toCounts = (rows, key) => Object.fromEntries(rows.map((row) => [row[key], row._count]));

// serviceId/service.slug are selected purely to let the client build the
// admin intake workspace URL (/admin/services/{slug}/courses/{courseId}
// /intakes/{id}) without a second lookup — same pattern
// sessionLibrary.service.js uses for its own "link straight to the intake"
// problem. Neither is displayed anywhere.
const INTAKE_CARD_SELECT = {
  id: true,
  code: true,
  courseId: true,
  serviceId: true,
  startDate: true,
  expectedEndDate: true,
  capacity: true,
  status: true,
  course: { select: { title: true } },
  service: { select: { slug: true } },
  _count: { select: { enrollments: true } },
};

// serviceId/service.slug (via course) are selected purely to let the client
// build the admin intake workspace URL, same reasoning as INTAKE_CARD_SELECT
// above — a pending request is worked from that same enrollment-requests tab
// (?tab=enrollment-requests&requestId={id}), there's no separate page for it.
const ENROLLMENT_REQUEST_CARD_SELECT = {
  id: true,
  intakeId: true,
  courseId: true,
  contactPhone: true,
  status: true,
  createdAt: true,
  student: { select: { firstName: true, lastName: true, email: true } },
  course: { select: { title: true, serviceId: true, service: { select: { slug: true } } } },
};

function mapEnrollmentRequestRow(row) {
  const name = `${row.student?.firstName ?? ""} ${row.student?.lastName ?? ""}`.trim();
  return {
    id: row.id,
    intakeId: row.intakeId,
    courseId: row.courseId,
    serviceId: row.course?.serviceId ?? null,
    serviceSlug: row.course?.service?.slug ?? null,
    courseTitle: row.course?.title ?? "Untitled course",
    studentName: name || row.student?.email || "Unknown student",
    studentEmail: row.student?.email ?? null,
    contactPhone: row.contactPhone,
    status: row.status,
    createdAt: row.createdAt,
  };
}

function mapIntakeRow(row, deliveryStats) {
  const stats = deliveryStats?.get(row.id);
  return {
    id: row.id,
    code: row.code,
    courseId: row.courseId,
    serviceId: row.serviceId,
    serviceSlug: row.service?.slug ?? null,
    title: row.course?.title ?? "Untitled course",
    status: row.status,
    startDate: row.startDate,
    expectedEndDate: row.expectedEndDate,
    capacity: row.capacity,
    enrolledCount: row._count.enrollments,
    totalSessions: stats?.totalSessions ?? 0,
    releasedSessions: stats?.releasedSessions ?? 0,
    releaseProgressPct: stats?.releaseProgressPct ?? null,
    completionPct: stats?.completionPct ?? null,
  };
}

// Curriculum-release and completion stats for a bounded set of intakes (the
// ones actually showing on the "Course delivery" card). Each of the four
// queries is a single groupBy riding on an existing index — CourseSession's
// [intakeId, deliveryStatus, availableAt] / [intakeId, retiredAt,
// orderIndex], SessionCompletion's plain [intakeId], Enrollment's
// [intakeId, status] — so this stays cheap regardless of platform size; it's
// never a per-intake query loop.
async function getIntakeDeliveryStats(intakeIds) {
  if (intakeIds.length === 0) return new Map();
  const now = new Date();

  const [eligibleRows, totalRows, completionRows, activeEnrollmentRows] = await Promise.all([
    // "Released" curriculum — the exact same definition a student's
    // classroom uses (see visibleCourseSessionWhere), not a fresh rule.
    prisma.courseSession.groupBy({ by: ["intakeId"], where: visibleCourseSessionWhere({ in: intakeIds }, now), _count: true }),
    // Total current (non-retired) curriculum, to turn "released" into a %.
    prisma.courseSession.groupBy({ by: ["intakeId"], where: { intakeId: { in: intakeIds }, retiredAt: null }, _count: true }),
    prisma.sessionCompletion.groupBy({ by: ["intakeId"], where: { intakeId: { in: intakeIds } }, _count: true }),
    prisma.enrollment.groupBy({ by: ["intakeId"], where: { intakeId: { in: intakeIds }, status: "ACTIVE" }, _count: true }),
  ]);

  const eligibleByIntake = toCounts(eligibleRows, "intakeId");
  const totalByIntake = toCounts(totalRows, "intakeId");
  const completionsByIntake = toCounts(completionRows, "intakeId");
  const activeEnrollmentsByIntake = toCounts(activeEnrollmentRows, "intakeId");

  const stats = new Map();
  for (const id of intakeIds) {
    const totalSessions = totalByIntake[id] ?? 0;
    const releasedSessions = eligibleByIntake[id] ?? 0;
    // Completion % denominator is "every (active enrollment × released
    // session) pair" — the same shape findProgressForEnrollments already
    // uses per-student, just aggregated platform-wide instead of per-user.
    const possibleCompletions = releasedSessions * (activeEnrollmentsByIntake[id] ?? 0);
    stats.set(id, {
      totalSessions,
      releasedSessions,
      releaseProgressPct: totalSessions > 0 ? Math.round((releasedSessions / totalSessions) * 100) : null,
      completionPct: possibleCompletions > 0 ? Math.round(((completionsByIntake[id] ?? 0) / possibleCompletions) * 100) : null,
    });
  }
  return stats;
}

export async function getAdminSummary(options = {}) {
  const { start: trendSince, end: trendUntil } = resolveTrendWindow(options);
  const monthBuckets = seedMonthBuckets(trendSince, trendUntil);

  const [
    totalStudents,
    totalActiveEnrollments,
    pendingEnrollmentRequests,
    totalCertificatesIssued,
    pendingProjectReviews,
    revenueAgg,
    enrollmentDates,
    payments,
    enrollmentStatusRows,
    certificateStatusRows,
    projectStatusRows,
    paymentStatusRows,
    districtRows,
    topCourseRows,
    serviceEnrollments,
    payableEnrollments,
    runningIntakeRows,
    upcomingIntakeRows,
    overdueIntakeRows,
    enrollmentRequestRows,
  ] = await Promise.all([
    prisma.user.count({ where: { role: "STUDENT" } }),
    prisma.enrollment.count({ where: { status: "ACTIVE" } }),
    prisma.enrollmentRequest.count({ where: { status: "PENDING" } }),
    prisma.certificate.count({ where: { status: "ISSUED" } }),
    prisma.studentProject.count({ where: { status: "PENDING" } }),
    prisma.payment.aggregate({ _sum: { amount: true } }),
    // Enrollment/revenue trends: bounded to the selected window, minimal
    // columns selected, bucketed by month in JS below — the same "cheap
    // single query, bucket client-side" shape the learning-activity
    // heatmap already established, just platform-wide instead of per-user.
    prisma.enrollment.findMany({
      where: { createdAt: { gte: trendSince, lte: trendUntil } },
      select: { createdAt: true },
    }),
    prisma.payment.findMany({
      where: { createdAt: { gte: trendSince, lte: trendUntil } },
      select: { amount: true, createdAt: true },
    }),
    prisma.enrollment.groupBy({ by: ["status"], _count: true }),
    prisma.certificate.groupBy({ by: ["status"], _count: true }),
    prisma.studentProject.groupBy({ by: ["status"], _count: true }),
    // "Fully paid" vs "still paying" — among enrollments that actually owe
    // money (NOT_REQUIRED/free plans excluded). All-time, not part of the
    // trend window — a snapshot of the current book, not a trend over it.
    prisma.enrollment.groupBy({
      by: ["paymentStatus"],
      where: { status: { not: "CANCELLED" }, paymentStatus: { not: "NOT_REQUIRED" } },
      _count: true,
    }),
    prisma.user.groupBy({
      by: ["district"],
      where: { role: "STUDENT", district: { not: null } },
      _count: true,
      orderBy: { _count: { district: "desc" } },
      take: 8,
    }),
    prisma.enrollment.groupBy({
      by: ["courseId"],
      where: { status: { not: "CANCELLED" } },
      _count: true,
      orderBy: { _count: { courseId: "desc" } },
      take: 5,
    }),
    // Service-level breakdown: which top-level offering (Bootcamps,
    // Workshops, ...) active enrollments concentrate in. Bounded to ACTIVE
    // enrollments only, so this stays a small, cheap fetch.
    prisma.enrollment.findMany({
      where: { status: "ACTIVE" },
      select: { course: { select: { service: { select: { title: true } } } } },
    }),
    // Revenue-receivable summary: every non-cancelled, payment-required
    // enrollment's course price/discount, to compute what "everyone paid
    // in full" would have totaled versus what's actually been collected.
    // A COMPLETED (fully paid) enrollment already had the one-shot discount
    // applied, so its "full amount" is price minus that discount; a PARTIAL
    // (still paying in installments) enrollment owes the plain price.
    prisma.enrollment.findMany({
      where: { status: { not: "CANCELLED" }, paymentStatus: { not: "NOT_REQUIRED" } },
      select: { paymentStatus: true, course: { select: { price: true, discountAmount: true } } },
    }),
    // "Services delivered" — what's actually in progress right now: started,
    // not yet past its expected end. Small bounded list, soonest-ending first.
    prisma.intake.findMany({
      where: {
        status: { in: ["OPEN_ACTIVE", "CLOSED_ACTIVE"] },
        startDate: { lte: new Date() },
        OR: [{ expectedEndDate: null }, { expectedEndDate: { gte: new Date() } }],
      },
      orderBy: { startDate: "asc" },
      take: 6,
      select: INTAKE_CARD_SELECT,
    }),
    // Not started yet — lets admins see what's about to need attention
    // (instructor/session prep, marketing) before it goes live.
    prisma.intake.findMany({
      where: { status: { in: ["DRAFT", "OPEN_ACTIVE"] }, startDate: { gt: new Date() } },
      orderBy: { startDate: "asc" },
      take: 6,
      select: INTAKE_CARD_SELECT,
    }),
    // Past its own expected end date but never moved to COMPLETED/ARCHIVED —
    // a cohort that needs an admin to actually close it out. Most-overdue
    // (oldest expectedEndDate) first.
    prisma.intake.findMany({
      where: { status: { in: ["OPEN_ACTIVE", "CLOSED_ACTIVE"] }, expectedEndDate: { lt: new Date() } },
      orderBy: { expectedEndDate: "asc" },
      take: 6,
      select: INTAKE_CARD_SELECT,
    }),
    // Oldest-pending-first: whoever's been waiting longest needs an admin's
    // attention first. Small bounded list, same shape as the intake cards.
    prisma.enrollmentRequest.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: 6,
      select: ENROLLMENT_REQUEST_CARD_SELECT,
    }),
  ]);

  // Curriculum-release / completion stats for whichever intakes are
  // actually showing on the delivery card (running + upcoming + overdue,
  // capped at 18 ids total) — a second small round trip since it depends on
  // the ids above, but each of the three queries below is a single `groupBy`
  // riding on an existing index (CourseSession's
  // [intakeId, deliveryStatus, availableAt] / [intakeId, retiredAt,
  // orderIndex], SessionCompletion's plain [intakeId], Enrollment's
  // [intakeId, status]) — bounded to at most 18 rows each, not a per-intake
  // query loop.
  const deliveryIntakeIds = [...new Set([...runningIntakeRows, ...upcomingIntakeRows, ...overdueIntakeRows].map((row) => row.id))];
  const deliveryStats = await getIntakeDeliveryStats(deliveryIntakeIds);

  const enrollmentCounts = new Map(monthBuckets.map((bucket) => [bucket.key, 0]));
  for (const { createdAt } of enrollmentDates) {
    const key = monthKey(createdAt);
    if (enrollmentCounts.has(key)) enrollmentCounts.set(key, enrollmentCounts.get(key) + 1);
  }
  const enrollmentTrend = monthBuckets.map((bucket) => ({ month: bucket.label, count: enrollmentCounts.get(bucket.key) }));

  const revenueTotals = new Map(monthBuckets.map((bucket) => [bucket.key, 0]));
  for (const { amount, createdAt } of payments) {
    const key = monthKey(createdAt);
    if (revenueTotals.has(key)) revenueTotals.set(key, revenueTotals.get(key) + Number(amount));
  }
  const revenueTrend = monthBuckets.map((bucket) => ({ month: bucket.label, amount: revenueTotals.get(bucket.key) }));

  const topCourseIds = topCourseRows.map((row) => row.courseId);
  const topCourseDetails = topCourseIds.length
    ? await prisma.course.findMany({ where: { id: { in: topCourseIds } }, select: { id: true, title: true } })
    : [];
  const courseTitleById = new Map(topCourseDetails.map((course) => [course.id, course.title]));
  const topCourses = topCourseRows.map((row) => ({
    courseId: row.courseId,
    title: courseTitleById.get(row.courseId) ?? "Untitled course",
    count: row._count,
  }));

  const serviceCounts = new Map();
  for (const { course } of serviceEnrollments) {
    const title = course?.service?.title ?? "Other";
    serviceCounts.set(title, (serviceCounts.get(title) ?? 0) + 1);
  }
  const serviceBreakdown = Array.from(serviceCounts, ([service, count]) => ({ service, count })).sort(
    (a, b) => b.count - a.count,
  );

  const availableRevenue = Number(revenueAgg._sum.amount ?? 0);
  const fullPotentialRevenue = payableEnrollments.reduce((sum, enrollment) => {
    const price = Number(enrollment.course?.price ?? 0);
    const discount = Number(enrollment.course?.discountAmount ?? 0);
    const fullAmount = enrollment.paymentStatus === "COMPLETED" ? price - discount : price;
    return sum + Math.max(0, fullAmount);
  }, 0);
  const revenueToCome = Math.max(0, fullPotentialRevenue - availableRevenue);

  return {
    totalStudents,
    totalActiveEnrollments,
    pendingEnrollmentRequests,
    totalCertificatesIssued,
    pendingProjectReviews,
    totalRevenue: availableRevenue,
    fullPotentialRevenue,
    revenueToCome,
    enrollmentTrend,
    revenueTrend,
    enrollmentStatusBreakdown: toCounts(enrollmentStatusRows, "status"),
    certificateStatusBreakdown: toCounts(certificateStatusRows, "status"),
    projectStatusBreakdown: toCounts(projectStatusRows, "status"),
    paymentStatusBreakdown: toCounts(paymentStatusRows, "paymentStatus"),
    districtBreakdown: districtRows.map((row) => ({ district: row.district, count: row._count })),
    topCourses,
    serviceBreakdown,
    runningIntakes: runningIntakeRows.map((row) => mapIntakeRow(row, deliveryStats)),
    upcomingIntakes: upcomingIntakeRows.map((row) => mapIntakeRow(row, deliveryStats)),
    overdueIntakes: overdueIntakeRows.map((row) => mapIntakeRow(row, deliveryStats)),
    enrollmentRequestsList: enrollmentRequestRows.map(mapEnrollmentRequestRow),
  };
}
