import prisma from "../../../utils/prisma.js";

/**
 * Dashboard Repository - The "Front Page"
 * Small, bounded aggregate queries for the two role-specific dashboards.
 * Each is a handful of counts (or a short recent list) run in parallel —
 * no per-row N+1 work, so this stays fast regardless of platform size.
 */

export async function getStudentSummary(userId) {
  const [coursesEnrolled, coursesCompleted, certificatesEarned, recentEnrollments] = await Promise.all([
    prisma.enrollment.count({ where: { userId, status: { not: "CANCELLED" } } }),
    prisma.enrollment.count({ where: { userId, status: "COMPLETED" } }),
    prisma.certificate.count({ where: { enrollment: { userId }, status: "ISSUED" } }),
    prisma.enrollment.findMany({
      where: { userId, status: { not: "CANCELLED" } },
      orderBy: { updatedAt: "desc" },
      take: 5,
      select: {
        id: true,
        status: true,
        updatedAt: true,
        course: { select: { title: true } },
        intake: { select: { code: true } },
      },
    }),
  ]);

  return { coursesEnrolled, coursesCompleted, certificatesEarned, recentEnrollments };
}

export async function getAdminSummary() {
  const [totalStudents, totalActiveEnrollments, pendingEnrollmentRequests, totalCertificatesIssued] =
    await Promise.all([
      prisma.user.count({ where: { role: "STUDENT" } }),
      prisma.enrollment.count({ where: { status: "ACTIVE" } }),
      prisma.enrollmentRequest.count({ where: { status: "PENDING" } }),
      prisma.certificate.count({ where: { status: "ISSUED" } }),
    ]);

  return { totalStudents, totalActiveEnrollments, pendingEnrollmentRequests, totalCertificatesIssued };
}
