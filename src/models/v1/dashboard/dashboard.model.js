/**
 * Dashboard Model - The "Front Page Layout"
 * Shapes the raw aggregate query results into each dashboard's response.
 */

export function toStudentDashboardResponse(summary) {
  return {
    coursesEnrolled: summary.coursesEnrolled,
    coursesCompleted: summary.coursesCompleted,
    certificatesEarned: summary.certificatesEarned,
    recentEnrollments: summary.recentEnrollments.map((enrollment) => ({
      id: enrollment.id,
      status: enrollment.status,
      updatedAt: enrollment.updatedAt,
      courseTitle: enrollment.course?.title ?? null,
      intakeCode: enrollment.intake?.code ?? null,
    })),
  };
}

export function toAdminDashboardResponse(summary) {
  return {
    totalStudents: summary.totalStudents,
    totalActiveEnrollments: summary.totalActiveEnrollments,
    pendingEnrollmentRequests: summary.pendingEnrollmentRequests,
    totalCertificatesIssued: summary.totalCertificatesIssued,
  };
}
