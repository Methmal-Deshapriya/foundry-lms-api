/**
 * Dashboard Model - The "Front Page Layout"
 * Shapes the raw aggregate query results into each dashboard's response.
 */

export function toStudentDashboardResponse(summary) {
  return {
    coursesEnrolled: summary.coursesEnrolled,
    coursesCompleted: summary.coursesCompleted,
    certificatesEarned: summary.certificatesEarned,
    continueLearning: summary.continueLearning,
    heatmap: summary.heatmap,
    recentActivity: summary.recentActivity,
    recentEnrollments: summary.recentEnrollments.map((enrollment) => ({
      id: enrollment.id,
      status: enrollment.status,
      updatedAt: enrollment.updatedAt,
      courseTitle: enrollment.course?.title ?? null,
      thumbnailUrl: enrollment.course?.thumbnailUrl ?? null,
      categoryVisualKey: enrollment.course?.category?.visualKey ?? null,
      intakeCode: enrollment.intake?.code ?? null,
      progress: summary.progressByEnrollment.get(enrollment.id) ?? null,
    })),
  };
}

export function toAdminDashboardResponse(summary) {
  return {
    totalStudents: summary.totalStudents,
    totalActiveEnrollments: summary.totalActiveEnrollments,
    pendingEnrollmentRequests: summary.pendingEnrollmentRequests,
    totalCertificatesIssued: summary.totalCertificatesIssued,
    pendingProjectReviews: summary.pendingProjectReviews,
    totalRevenue: summary.totalRevenue,
    enrollmentTrend: summary.enrollmentTrend,
    revenueTrend: summary.revenueTrend,
    enrollmentStatusBreakdown: summary.enrollmentStatusBreakdown,
    certificateStatusBreakdown: summary.certificateStatusBreakdown,
    projectStatusBreakdown: summary.projectStatusBreakdown,
    districtBreakdown: summary.districtBreakdown,
    topCourses: summary.topCourses,
    serviceBreakdown: summary.serviceBreakdown,
  };
}
