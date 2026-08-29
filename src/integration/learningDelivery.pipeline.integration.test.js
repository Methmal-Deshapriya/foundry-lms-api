import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import app from "../app.js";
import prisma from "../utils/prisma.js";
import { generateToken } from "../utils/jwt.js";

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === "1";

const ids = {
  paidService: "20000000-0000-4000-8000-000000000001",
  freeService: "20000000-0000-4000-8000-000000000003",
  admin: "f0000000-0000-4000-8000-000000000100",
  paidStudent: "f0000000-0000-4000-8000-000000000101",
  freeStudent: "f0000000-0000-4000-8000-000000000102",
  paidCategory: "f0000000-0000-4000-8000-000000000110",
  freeCategory: "f0000000-0000-4000-8000-000000000111",
  paidGroup: "f0000000-0000-4000-8000-000000000120",
  freeGroup: "f0000000-0000-4000-8000-000000000121",
  paidB1: "f0000000-0000-4000-8000-000000000130",
  paidB2: "f0000000-0000-4000-8000-000000000131",
  freeCourse: "f0000000-0000-4000-8000-000000000132",
  paidSession: "f0000000-0000-4000-8000-000000000140",
  freeSession: "f0000000-0000-4000-8000-000000000141",
  spareSession: "f0000000-0000-4000-8000-000000000142",
  paidB1Session: "f0000000-0000-4000-8000-000000000150",
  paidB2Session: "f0000000-0000-4000-8000-000000000151",
  freeCourseSession: "f0000000-0000-4000-8000-000000000152",
};

process.env.JWT_SECRET ||= "foundry-course-intake-integration-test";

function cookieFor(id, role) {
  return `token=${generateToken({ id, role, mfa: role !== "STUDENT" })}`;
}

const adminCookie = () => cookieFor(ids.admin, "SUPER_ADMIN");
const paidStudentCookie = () => cookieFor(ids.paidStudent, "STUDENT");
const freeStudentCookie = () => cookieFor(ids.freeStudent, "STUDENT");

const courseIds = [ids.paidB1, ids.paidB2, ids.freeCourse];
const userIds = [ids.admin, ids.paidStudent, ids.freeStudent];

async function cleanupFixture() {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: userIds } } });
  await prisma.certificate.deleteMany({ where: { enrollment: { courseId: { in: courseIds } } } });
  await prisma.sessionCompletion.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.studentProject.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.enrollment.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.courseSession.deleteMany({ where: { courseId: { in: courseIds } } });
  await prisma.course.deleteMany({ where: { id: { in: courseIds } } });
  await prisma.courseGroup.deleteMany({ where: { id: { in: [ids.paidGroup, ids.freeGroup] } } });
  await prisma.session.deleteMany({ where: { id: { in: [ids.paidSession, ids.freeSession, ids.spareSession] } } });
  await prisma.category.deleteMany({ where: { id: { in: [ids.paidCategory, ids.freeCategory] } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

function commonCourseData() {
  return {
    title: "Pipeline AI/ML Ignition",
    slug: "pipeline-ai-ml-ignition",
    summary: "A complete paid intake integration fixture.",
    description: "A complete paid intake integration fixture for validating delivery behavior.",
    level: "BEGINNER",
    durationValue: 4,
    durationUnit: "MONTH",
    price: 1000,
    currency: "LKR",
    highlights: ["Pipeline verification"],
    skills: ["Integration testing"],
    prerequisites: [],
  };
}

async function seedFixture() {
  await prisma.user.createMany({
    data: [
      { id: ids.admin, firstName: "Pipeline", lastName: "Admin", email: "pipeline-admin@foundry.test", password: "integration-test-only", role: "SUPER_ADMIN", emailVerified: true },
      { id: ids.paidStudent, firstName: "Paid", lastName: "Student", email: "pipeline-paid@foundry.test", password: "integration-test-only", role: "STUDENT", emailVerified: true },
      { id: ids.freeStudent, firstName: "Free", lastName: "Student", email: "pipeline-free@foundry.test", password: "integration-test-only", role: "STUDENT", emailVerified: true },
    ],
  });
  await prisma.category.createMany({
    data: [
      { id: ids.paidCategory, serviceId: ids.paidService, slug: "pipeline-ai-ml", title: "Pipeline AI/ML", description: "Paid pipeline integration category.", audienceLabel: "Beginning engineers", visualKey: "code2", status: "PUBLISHED" },
      { id: ids.freeCategory, serviceId: ids.freeService, slug: "pipeline-git", title: "Pipeline Git", description: "Free pipeline integration category.", audienceLabel: "Everyone", visualKey: "git-branch", status: "PUBLISHED" },
    ],
  });
  await prisma.courseGroup.createMany({
    data: [
      { id: ids.paidGroup, categoryId: ids.paidCategory, slug: "pipeline-ai-ml-ignition", title: "Pipeline AI/ML Ignition", batchCodePrefix: "PIPELINE-AI-ML", certificateEnabled: true },
      { id: ids.freeGroup, categoryId: ids.freeCategory, slug: "pipeline-git-foundations", title: "Pipeline Git Foundations", batchCodePrefix: "PIPELINE-GIT", certificateEnabled: false },
    ],
  });
  await prisma.course.createMany({
    data: [
      { id: ids.paidB1, courseGroupId: ids.paidGroup, categoryId: ids.paidCategory, intakeKey: "2026-B1", code: "PIPELINE-AI-ML-2026-B1", startDate: new Date("2026-08-01"), expectedEndDate: new Date("2026-12-01"), timezone: "Asia/Colombo", capacity: 10, status: "OPEN_ACTIVE", ...commonCourseData() },
      { id: ids.paidB2, courseGroupId: ids.paidGroup, categoryId: ids.paidCategory, intakeKey: "2026-B2", code: "PIPELINE-AI-ML-2026-B2", startDate: new Date("2026-12-01"), expectedEndDate: new Date("2027-04-01"), timezone: "Asia/Colombo", capacity: 10, status: "DRAFT", ...commonCourseData() },
      { id: ids.freeCourse, courseGroupId: ids.freeGroup, categoryId: ids.freeCategory, title: "Pipeline Git Foundations", slug: "pipeline-git-foundations", intakeKey: "EVERGREEN", code: "PIPELINE-GIT-EVERGREEN", startDate: null, expectedEndDate: null, timezone: "Asia/Colombo", capacity: null, summary: "A complete free learning integration fixture.", description: "A complete free learning integration fixture for verified self enrollment.", level: "OPEN", durationValue: 2, durationUnit: "SESSION", price: 0, currency: "LKR", highlights: [], skills: [], prerequisites: [], status: "OPEN_ACTIVE" },
    ],
  });
  await prisma.session.createMany({
    data: [
      { id: ids.paidSession, title: "Paid pipeline session", recordingUrl: "https://example.com/paid-recording", status: "READY" },
      { id: ids.freeSession, title: "Free pipeline session", recordingUrl: "https://example.com/free-recording", status: "READY" },
      { id: ids.spareSession, title: "Spare terminal-write check", recordingUrl: "https://example.com/spare-recording", status: "READY" },
    ],
  });
  await prisma.courseSession.createMany({
    data: [
      { id: ids.paidB1Session, courseId: ids.paidB1, sessionId: ids.paidSession, orderIndex: 0, deliveryStatus: "RELEASED", firstReleasedAt: new Date() },
      { id: ids.paidB2Session, courseId: ids.paidB2, sessionId: ids.paidSession, orderIndex: 0, deliveryStatus: "UNRELEASED" },
      { id: ids.freeCourseSession, courseId: ids.freeCourse, sessionId: ids.freeSession, orderIndex: 0, deliveryStatus: "RELEASED", firstReleasedAt: new Date() },
    ],
  });
}

describe.runIf(runDatabaseIntegration)("course-group and course-intake delivery pipeline", () => {
  beforeAll(async () => {
    await cleanupFixture();
    await seedFixture();
  }, 60_000);

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await cleanupFixture();
  }, 60_000);

  it("keeps copied intake curricula independent after attach, reorder, and detach", async () => {
    const attach = await request(app)
      .post(`/api/v1/courses/${ids.paidB2}/curriculum`)
      .set("Cookie", adminCookie())
      .send({ sessionId: ids.spareSession });
    expect(attach.status).toBe(201);
    const spareCourseSessionId = attach.body.data.courseSession.id;

    const reorder = await request(app)
      .patch(`/api/v1/courses/${ids.paidB2}/curriculum/reorder`)
      .set("Cookie", adminCookie())
      .send({
        courseSessions: [
          { id: spareCourseSessionId, orderIndex: 0 },
          { id: ids.paidB2Session, orderIndex: 1 },
        ],
      });
    expect(reorder.status).toBe(200);

    const sourceCurriculum = await prisma.courseSession.findMany({
      where: { courseId: ids.paidB1, retiredAt: null },
      orderBy: { orderIndex: "asc" },
      select: { id: true, sessionId: true, orderIndex: true, deliveryStatus: true },
    });
    expect(sourceCurriculum).toEqual([
      { id: ids.paidB1Session, sessionId: ids.paidSession, orderIndex: 0, deliveryStatus: "RELEASED" },
    ]);

    const detach = await request(app)
      .delete(`/api/v1/courses/${ids.paidB2}/curriculum/${spareCourseSessionId}`)
      .set("Cookie", adminCookie());
    expect(detach.status).toBe(200);

    const copiedCurriculum = await prisma.courseSession.findMany({
      where: { courseId: ids.paidB2, retiredAt: null },
      select: { id: true, sessionId: true, orderIndex: true, deliveryStatus: true },
    });
    expect(copiedCurriculum).toEqual([
      { id: ids.paidB2Session, sessionId: ids.paidSession, orderIndex: 0, deliveryStatus: "UNRELEASED" },
    ]);
  }, 60_000);

  it("atomically hands public enrollment from B1 to B2 without exposing intake metadata", async () => {
    const handover = await request(app)
      .patch(`/api/v1/courses/${ids.paidB2}/status`)
      .set("Cookie", adminCookie())
      .send({ expectedStatus: "DRAFT", status: "OPEN_ACTIVE" });
    expect(handover.status).toBe(200);

    const siblings = await prisma.course.findMany({ where: { courseGroupId: ids.paidGroup }, select: { id: true, status: true } });
    expect(siblings).toEqual(expect.arrayContaining([
      { id: ids.paidB1, status: "CLOSED_ACTIVE" },
      { id: ids.paidB2, status: "OPEN_ACTIVE" },
    ]));

    const publicCourse = await request(app).get("/api/v1/catalog/bootcamps/categories/pipeline-ai-ml/courses/pipeline-ai-ml-ignition");
    expect(publicCourse.status).toBe(200);
    expect(publicCourse.body.data).toMatchObject({ id: ids.paidB2, title: "Pipeline AI/ML Ignition" });
    expect(publicCourse.body.data).not.toHaveProperty("courseGroupId");
    expect(publicCourse.body.data).not.toHaveProperty("intakeKey");
    expect(publicCourse.body.data).not.toHaveProperty("code");

    await expect(
      prisma.course.update({ where: { id: ids.paidB1 }, data: { status: "OPEN_ACTIVE" } }),
    ).rejects.toBeTruthy();
  }, 60_000);

  it("delivers, completes, certifies, and freezes one paid course intake", async () => {
    const release = await request(app)
      .patch(`/api/v1/courses/${ids.paidB2}/curriculum/${ids.paidB2Session}/delivery`)
      .set("Cookie", adminCookie())
      .send({ status: "RELEASED" });
    expect(release.status).toBe(200);

    const enrollmentResponse = await request(app)
      .post(`/api/v1/courses/${ids.paidB2}/enrollments`)
      .set("Cookie", adminCookie())
      .send({ userId: ids.paidStudent, paymentStatus: "COMPLETED" });
    expect(enrollmentResponse.status).toBe(201);
    const enrollmentId = enrollmentResponse.body.data.id;

    await expect(
      prisma.sessionCompletion.create({
        data: {
          enrollmentId,
          courseSessionId: ids.freeCourseSession,
          courseId: ids.paidB2,
        },
      }),
    ).rejects.toBeTruthy();

    const close = await request(app)
      .patch(`/api/v1/courses/${ids.paidB2}/status`)
      .set("Cookie", adminCookie())
      .send({ expectedStatus: "OPEN_ACTIVE", status: "CLOSED_ACTIVE" });
    expect(close.status).toBe(200);

    const classroom = await request(app)
      .get(`/api/v1/enrollments/${enrollmentId}/classroom`)
      .set("Cookie", paidStudentCookie());
    expect(classroom.status).toBe(200);
    expect(classroom.body.data.sessions).toHaveLength(1);
    expect(classroom.body.data.enrollment.course).toMatchObject({ intakeKey: "2026-B2", code: "PIPELINE-AI-ML-2026-B2" });

    const completion = await request(app)
      .post(`/api/v1/enrollments/${enrollmentId}/sessions/${ids.paidB2Session}/complete`)
      .set("Cookie", paidStudentCookie());
    expect(completion.status).toBe(201);

    const completeEnrollment = await request(app)
      .patch(`/api/v1/enrollments/${enrollmentId}`)
      .set("Cookie", adminCookie())
      .send({ status: "COMPLETED" });
    expect(completeEnrollment.status).toBe(200);

    const frozenProgress = await request(app)
      .delete(`/api/v1/enrollments/${enrollmentId}/sessions/${ids.paidB2Session}/complete`)
      .set("Cookie", paidStudentCookie());
    expect(frozenProgress.status).toBe(409);
    expect(frozenProgress.body.code).toBe("ENROLLMENT_COMPLETED");

    const issue = await request(app)
      .post(`/api/v1/enrollments/${enrollmentId}/certificate`)
      .set("Cookie", adminCookie())
      .send({ description: "Pipeline completion" });
    expect(issue.status).toBe(201);

    const completeCourse = await request(app)
      .patch(`/api/v1/courses/${ids.paidB2}/status`)
      .set("Cookie", adminCookie())
      .send({ expectedStatus: "CLOSED_ACTIVE", status: "COMPLETED" });
    expect(completeCourse.status).toBe(200);

    const terminalAttach = await request(app)
      .post(`/api/v1/courses/${ids.paidB2}/curriculum`)
      .set("Cookie", adminCookie())
      .send({ sessionId: ids.spareSession });
    expect(terminalAttach.status).toBe(409);
  }, 60_000);

  it("self-enrolls and reactivates the same free evergreen enrollment", async () => {
    await expect(
      prisma.course.create({
        data: {
          id: "f0000000-0000-4000-8000-000000000199",
          courseGroupId: ids.freeGroup,
          categoryId: ids.freeCategory,
          title: "Pipeline Git Foundations",
          slug: "pipeline-git-foundations",
          intakeKey: "EVERGREEN-2",
          code: "PIPELINE-GIT-EVERGREEN-2",
          timezone: "Asia/Colombo",
          summary: "A duplicate evergreen database invariant fixture.",
          description: "A duplicate evergreen database invariant fixture that must be rejected.",
          level: "OPEN",
          price: 0,
          currency: "LKR",
          status: "DRAFT",
        },
      }),
    ).rejects.toBeTruthy();

    const first = await request(app)
      .post(`/api/v1/courses/${ids.freeCourse}/enroll`)
      .set("Cookie", freeStudentCookie());
    expect(first.status).toBe(201);
    const enrollmentId = first.body.data.id;

    const cancel = await request(app)
      .patch(`/api/v1/enrollments/${enrollmentId}`)
      .set("Cookie", adminCookie())
      .send({ status: "CANCELLED" });
    expect(cancel.status).toBe(200);

    const reactivated = await request(app)
      .post(`/api/v1/courses/${ids.freeCourse}/enroll`)
      .set("Cookie", freeStudentCookie());
    expect(reactivated.status).toBe(200);
    expect(reactivated.body.data).toMatchObject({ id: enrollmentId, status: "ACTIVE" });

    const removeOnlyVisibleSession = await request(app)
      .delete(`/api/v1/courses/${ids.freeCourse}/curriculum/${ids.freeCourseSession}`)
      .set("Cookie", adminCookie());
    expect(removeOnlyVisibleSession.status).toBe(409);
    expect(removeOnlyVisibleSession.body.code).toBe("FREE_COURSE_REQUIRES_VISIBLE_SESSION");
  }, 60_000);

  it("blocks destructive catalog changes and exposes no legacy batch API", async () => {
    const groupImpact = await request(app)
      .get(`/api/v1/course-groups/${ids.paidGroup}/deletion-impact`)
      .set("Cookie", adminCookie());
    expect(groupImpact.status).toBe(200);
    expect(groupImpact.body.data).toMatchObject({
      resourceType: "COURSE_GROUP",
      resourceStatus: "ACTIVE",
      courses: 2,
      deletable: false,
    });

    const archive = await request(app)
      .patch(`/api/v1/categories/${ids.freeCategory}/archive`)
      .set("Cookie", adminCookie());
    expect(archive.status).toBe(409);
    expect(archive.body.code).toBe("CATALOG_ARCHIVE_BLOCKED");

    const legacy = await request(app)
      .get("/api/v1/batches/f0000000-0000-4000-8000-000000000199")
      .set("Cookie", adminCookie());
    expect(legacy.status).toBe(404);
  }, 60_000);
});
