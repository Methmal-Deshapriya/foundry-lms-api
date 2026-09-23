/**
 * Dashboard Model - The "Front Page Layout"
 * Shapes the raw aggregate query results into each dashboard's response.
 */
import { resolveThumbnailUrl } from "../../../utils/thumbnails.js";

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
      thumbnailUrl: enrollment.course ? resolveThumbnailUrl(enrollment.course) : null,
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
    fullPotentialRevenue: summary.fullPotentialRevenue,
    revenueToCome: summary.revenueToCome,
    enrollmentTrend: summary.enrollmentTrend,
    revenueTrend: summary.revenueTrend,
    enrollmentStatusBreakdown: summary.enrollmentStatusBreakdown,
    certificateStatusBreakdown: summary.certificateStatusBreakdown,
    projectStatusBreakdown: summary.projectStatusBreakdown,
    paymentStatusBreakdown: summary.paymentStatusBreakdown,
    districtBreakdown: summary.districtBreakdown,
    topCourses: summary.topCourses,
    serviceBreakdown: summary.serviceBreakdown,
    runningIntakes: summary.runningIntakes,
    upcomingIntakes: summary.upcomingIntakes,
    overdueIntakes: summary.overdueIntakes,
    enrollmentRequestsList: summary.enrollmentRequestsList,
  };
}
