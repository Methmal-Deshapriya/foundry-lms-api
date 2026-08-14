import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../app.js";
import prisma from "../utils/prisma.js";
import { generateToken } from "../utils/jwt.js";

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === "1";

const ids = {
  admin: "f0000000-0000-4000-8000-000000000100",
  paidStudent: "f0000000-0000-4000-8000-000000000101",
  freeStudent: "f0000000-0000-4000-8000-000000000102",
  paidCategory: "f0000000-0000-4000-8000-000000000110",
  freeCategory: "f0000000-0000-4000-8000-000000000111",
  paidCourse: "f0000000-0000-4000-8000-000000000120",
  freeCourse: "f0000000-0000-4000-8000-000000000121",
  archiveCourse: "f0000000-0000-4000-8000-000000000122",
  paidSession: "f0000000-0000-4000-8000-000000000130",
  freeSession: "f0000000-0000-4000-8000-000000000131",
  paidCourseSession: "f0000000-0000-4000-8000-000000000140",
  freeCourseSession: "f0000000-0000-4000-8000-000000000141",
  paidBatch: "f0000000-0000-4000-8000-000000000150",
  archiveBatch: "f0000000-0000-4000-8000-000000000151",
};

process.env.JWT_SECRET ||= "foundry-pipeline-integration-test";

function cookieFor(id, role) {
  return `token=${generateToken({ id, role, mfa: role !== "STUDENT" })}`;
}

const adminCookie = () => cookieFor(ids.admin, "SUPER_ADMIN");
const paidStudentCookie = () => cookieFor(ids.paidStudent, "STUDENT");
const freeStudentCookie = () => cookieFor(ids.freeStudent, "STUDENT");

async function cleanupFixture() {
  const courseIds = [ids.paidCourse, ids.freeCourse, ids.archiveCourse];
  const userIds = [ids.admin, ids.paidStudent, ids.freeStudent];
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.certificate.deleteMany({
    where: { enrollment: { courseId: { in: courseIds } } },
  });
  await prisma.sessionCompletion.deleteMany({
    where: { courseId: { in: courseIds } },
  });
  await prisma.studentProject.deleteMany({
    where: { courseId: { in: courseIds } },
  });
  await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.batchSession.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.batch.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.courseSession.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.session.deleteMany({
    where: { id: { in: [ids.paidSession, ids.freeSession] } },
  });
  await prisma.category.deleteMany({
    where: { id: { in: [ids.paidCategory, ids.freeCategory] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

async function seedFixture() {
  await prisma.user.createMany({
    data: [
      {
        id: ids.admin,
        firstName: "Pipeline",
        lastName: "Admin",
        email: "pipeline-admin@foundry.test",
        password: "integration-test-only",
        role: "SUPER_ADMIN",
        emailVerified: true,
      },
      {
        id: ids.paidStudent,
        firstName: "Paid",
        lastName: "Student",
        email: "pipeline-paid@foundry.test",
        password: "integration-test-only",
        role: "STUDENT",
        emailVerified: true,
      },
      {
        id: ids.freeStudent,
        firstName: "Free",
        lastName: "Student",
        email: "pipeline-free@foundry.test",
        password: "integration-test-only",
        role: "STUDENT",
        emailVerified: true,
      },
    ],
  });
  await prisma.category.createMany({
    data: [
      {
        id: ids.paidCategory,
        serviceType: "BOOTCAMPS",
        slug: "pipeline-paid-category",
        title: "Pipeline Paid Category",
        description: "Integration fixture",
        visualKey: "code",
        status: "PUBLISHED",
      },
      {
        id: ids.freeCategory,
        serviceType: "FREE_LEARNING",
        slug: "pipeline-free-category",
        title: "Pipeline Free Category",
        description: "Integration fixture",
        visualKey: "sparkles",
        status: "PUBLISHED",
      },
    ],
  });
  await prisma.course.createMany({
    data: [
      {
        id: ids.paidCourse,
        categoryId: ids.paidCategory,
        slug: "pipeline-paid-course",
        title: "Pipeline Paid Course",
        summary: "Paid integration fixture",
        description: "Paid integration fixture",
        level: "BEGINNER",
        accessType: "PAID",
        price: 1000,
        certificateEnabled: true,
        skills: ["Pipeline testing"],
        status: "PUBLISHED",
      },
      {
        id: ids.freeCourse,
        categoryId: ids.freeCategory,
        slug: "pipeline-free-course",
        title: "Pipeline Free Course",
        summary: "Free integration fixture",
        description: "Free integration fixture",
        level: "OPEN",
        accessType: "FREE",
        price: 0,
        enrollmentStatus: "OPEN",
        certificateEnabled: false,
        status: "PUBLISHED",
      },
      {
        id: ids.archiveCourse,
        categoryId: ids.paidCategory,
        slug: "pipeline-archive-course",
        title: "Pipeline Archive Course",
        summary: "Archive integration fixture",
        description: "Archive integration fixture",
        level: "BEGINNER",
        accessType: "PAID",
        price: 1000,
        certificateEnabled: false,
        status: "PUBLISHED",
      },
    ],
  });
  await prisma.session.createMany({
    data: [
      {
        id: ids.paidSession,
        title: "Paid pipeline session",
        recordingUrl: "https://example.com/paid-recording",
        reusePolicy: "REUSABLE",
        status: "READY",
      },
      {
        id: ids.freeSession,
        title: "Free pipeline session",
        recordingUrl: "https://example.com/free-recording",
        reusePolicy: "REUSABLE",
        status: "READY",
      },
    ],
  });
  await prisma.courseSession.createMany({
    data: [
      {
        id: ids.paidCourseSession,
        courseId: ids.paidCourse,
        sessionId: ids.paidSession,
        orderIndex: 0,
      },
      {
        id: ids.freeCourseSession,
        courseId: ids.freeCourse,
        sessionId: ids.freeSession,
        orderIndex: 0,
      },
    ],
  });
  await prisma.batch.createMany({
    data: [
      {
        id: ids.paidBatch,
        courseId: ids.paidCourse,
        name: "Pipeline Active Batch",
        code: "PIPELINE-ACTIVE-2026",
        startDate: new Date("2026-08-01"),
        expectedEndDate: new Date("2026-12-01"),
        capacity: 10,
        status: "ACTIVE",
      },
      {
        id: ids.archiveBatch,
        courseId: ids.archiveCourse,
        name: "Pipeline Enrolling Batch",
        code: "PIPELINE-ENROLLING-2026",
        startDate: new Date("2026-09-01"),
        expectedEndDate: new Date("2026-12-01"),
        capacity: 10,
        status: "ENROLLING",
      },
    ],
  });
}

describe.runIf(runDatabaseIntegration)("learning delivery populated API pipeline", () => {
  beforeAll(async () => {
    await cleanupFixture();
    await seedFixture();
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await cleanupFixture();
  }, 60_000);

  it("delivers a paid cohort through replacement certification and completion", async () => {
    const release = await request(app)
      .patch(
        `/api/v1/batches/${ids.paidBatch}/sessions/${ids.paidCourseSession}/delivery`,
      )
      .set("Cookie", adminCookie())
      .send({ mode: "RELEASED" });
    expect(release.status).toBe(200);

    const enrollmentResponse = await request(app)
      .post(`/api/v1/batches/${ids.paidBatch}/enrollments`)
      .set("Cookie", adminCookie())
      .send({ userId: ids.paidStudent, paymentStatus: "COMPLETED" });
    expect(enrollmentResponse.status).toBe(201);
    const enrollmentId = enrollmentResponse.body.data.id;

    const completion = await request(app)
      .post(
        `/api/v1/enrollments/${enrollmentId}/sessions/${ids.paidCourseSession}/complete`,
      )
      .set("Cookie", paidStudentCookie());
    expect(completion.status).toBe(201);

    const completedEnrollment = await request(app)
      .patch(`/api/v1/enrollments/${enrollmentId}`)
      .set("Cookie", adminCookie())
      .send({ status: "COMPLETED" });
    expect(completedEnrollment.status).toBe(200);

    const firstCertificate = await request(app)
      .post(`/api/v1/enrollments/${enrollmentId}/certificate`)
      .set("Cookie", adminCookie())
      .send({ description: "Pipeline completion" });
    expect(firstCertificate.status).toBe(201);

    const revoked = await request(app)
      .patch(`/api/v1/certificates/${firstCertificate.body.data.id}/revoke`)
      .set("Cookie", adminCookie())
      .send({ revocationReason: "Replacement required for integration test" });
    expect(revoked.status).toBe(200);
    expect(revoked.body.data.status).toBe("REVOKED");

    const replacement = await request(app)
      .post(`/api/v1/enrollments/${enrollmentId}/certificate`)
      .set("Cookie", adminCookie())
      .send({ description: "Replacement pipeline certificate" });
    expect(replacement.status).toBe(201);
    expect(replacement.body.data.certificateCode).not.toBe(
      firstCertificate.body.data.certificateCode,
    );

    const completedBatch = await request(app)
      .patch(`/api/v1/batches/${ids.paidBatch}/status`)
      .set("Cookie", adminCookie())
      .send({ status: "COMPLETED" });
    expect(completedBatch.status).toBe(200);
    expect(completedBatch.body.data.status).toBe("COMPLETED");

    const [oldVerification, currentVerification] = await Promise.all([
      request(app).get(
        `/api/v1/certificates/verify/${firstCertificate.body.data.certificateCode}`,
      ),
      request(app).get(
        `/api/v1/certificates/verify/${replacement.body.data.certificateCode}`,
      ),
    ]);
    expect(oldVerification.body.data.status).toBe("REVOKED");
    expect(currentVerification.body.data.status).toBe("ISSUED");
  }, 60_000);

  it("supports status-only Free Learning cancellation and same-row re-enrollment", async () => {
    const firstEnrollment = await request(app)
      .post(`/api/v1/courses/${ids.freeCourse}/enroll`)
      .set("Cookie", freeStudentCookie())
      .send();
    expect(firstEnrollment.status).toBe(201);
    const enrollmentId = firstEnrollment.body.data.id;

    const cancelled = await request(app)
      .patch(`/api/v1/enrollments/${enrollmentId}`)
      .set("Cookie", adminCookie())
      .send({ status: "CANCELLED" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.paymentStatus).toBe("NOT_REQUIRED");

    const reactivated = await request(app)
      .post(`/api/v1/courses/${ids.freeCourse}/enroll`)
      .set("Cookie", freeStudentCookie())
      .send();
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.data.id).toBe(enrollmentId);
    expect(reactivated.body.data.status).toBe("ACTIVE");
  }, 60_000);

  it("blocks archival until an enrolling batch is explicitly cancelled", async () => {
    const blocked = await request(app)
      .patch(`/api/v1/courses/${ids.archiveCourse}/archive`)
      .set("Cookie", adminCookie())
      .send();
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("CATALOG_ARCHIVE_BLOCKED");

    const cancelled = await request(app)
      .patch(`/api/v1/batches/${ids.archiveBatch}/status`)
      .set("Cookie", adminCookie())
      .send({ status: "CANCELLED" });
    expect(cancelled.status).toBe(200);

    const archived = await request(app)
      .patch(`/api/v1/courses/${ids.archiveCourse}/archive`)
      .set("Cookie", adminCookie())
      .send();
    expect(archived.status).toBe(200);
    expect(archived.body.data.status).toBe("ARCHIVED");
  }, 60_000);
});
