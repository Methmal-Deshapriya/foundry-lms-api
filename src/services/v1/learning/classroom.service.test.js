import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/learning/classroom.repository.js", () => ({
  findEnrollmentContext: vi.fn(), findVisibleSessions: vi.fn(), findCompletion: vi.fn(), createCompletion: vi.fn(), removeCompletion: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as classroomRepository from "../../../repositories/v1/learning/classroom.repository.js";
import { completeClassroomSessionService, getClassroomService, getClassroomSessionService, uncompleteClassroomSessionService } from "./classroom.service.js";

const enrollmentId = "a0000000-0000-4000-8000-000000000001";
const userId = "a0000000-0000-4000-8000-000000000002";
const courseId = "a0000000-0000-4000-8000-000000000003";
const courseSessionId = "a0000000-0000-4000-8000-000000000004";
const intakeId = "a0000000-0000-4000-8000-000000000005";

function servicePolicy(free) {
  return { status: "ACTIVE", accessType: free ? "FREE" : "PAID", courseMode: free ? "EVERGREEN" : "SEASONAL", enrollmentMode: free ? "SELF" : "ADMIN", paymentRequirement: free ? "NOT_REQUIRED" : "REQUIRED" };
}

function course(free = false, overrides = {}) {
  return { id: courseId, title: "Course", slug: "course", summary: "Summary", level: "BEGINNER", durationValue: 1, durationUnit: "MONTH", price: free ? 0 : 1000, currency: "LKR", certificateEnabled: false, category: { service: servicePolicy(free) }, ...overrides };
}

function intake(free = false, overrides = {}) {
  return { id: intakeId, intakeKey: free ? "EVERGREEN" : "2026-B1", code: free ? "COURSE-EVERGREEN" : "COURSE-2026-B1", status: "OPEN_ACTIVE", category: { service: servicePolicy(free) }, ...overrides };
}

function enrollment(overrides = {}) {
  return { id: enrollmentId, userId, courseId, intakeId, source: "ADMIN", status: "ACTIVE", paymentStatus: "COMPLETED", user: { id: userId, emailVerified: true }, course: course(), intake: intake(), ...overrides };
}

function curriculumSession(completed = false, overrides = {}) {
  return { id: courseSessionId, orderIndex: 0, historicalOrderIndex: null, deliveryStatus: "RELEASED", availableAt: null, retiredAt: null, session: { title: "Session 1", description: "Lesson", recordingUrl: "https://example.com/recording", materialUrl: null, quizUrl: null, feedbackUrl: null, durationMinutes: 60, status: "READY" }, completions: completed ? [{ id: "completion", completedAt: new Date() }] : [], ...overrides };
}

describe("course classroom service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("serves released course curriculum to a free self-enrollment", async () => {
    classroomRepository.findEnrollmentContext.mockResolvedValue(enrollment({ source: "SELF", paymentStatus: "NOT_REQUIRED", course: course(true), intake: intake(true) }));
    classroomRepository.findVisibleSessions.mockResolvedValue([curriculumSession(true), curriculumSession(false, { id: "second" })]);
    const result = await getClassroomService(enrollmentId, { id: userId, role: "STUDENT" });
    expect(result.enrollment.deliveryMode).toBe("FREE");
    expect(result.progress).toMatchObject({ completedCount: 1, availableSessionCount: 2, progressPercent: 50 });
    expect(classroomRepository.findVisibleSessions).toHaveBeenCalledWith(intakeId, enrollmentId);
  });

  it("grants full classroom access to a partially paid enrollment, same as a fully paid one", async () => {
    classroomRepository.findEnrollmentContext.mockResolvedValue(enrollment({ paymentStatus: "PARTIAL" }));
    classroomRepository.findVisibleSessions.mockResolvedValue([curriculumSession(true), curriculumSession(false, { id: "second" })]);
    const result = await getClassroomService(enrollmentId, { id: userId, role: "STUDENT" });
    expect(result.enrollment.deliveryMode).toBe("PAID");
  });

  it("blocks paid classroom access for an enrollment with no payment recorded at all (defense in depth — the DB's own check constraint should already prevent this state)", async () => {
    classroomRepository.findEnrollmentContext.mockResolvedValue(enrollment({ paymentStatus: "NOT_REQUIRED" }));
    await expect(getClassroomService(enrollmentId, { id: userId, role: "STUDENT" })).rejects.toThrow(/payment must be recorded/i);
  });

  it("isolates one learner from another learner's enrollment", async () => {
    classroomRepository.findEnrollmentContext.mockResolvedValue(enrollment());
    await expect(getClassroomService(enrollmentId, { id: "another-user", role: "STUDENT" })).rejects.toThrow(/do not have access/i);
  });

  it("does not expose curriculum absent from the resolved course delivery", async () => {
    classroomRepository.findEnrollmentContext.mockResolvedValue(enrollment());
    classroomRepository.findVisibleSessions.mockResolvedValue([]);
    await expect(getClassroomSessionService(enrollmentId, courseSessionId, { id: userId, role: "STUDENT" })).rejects.toThrow(/not available/i);
  });

  it("creates completion idempotently in enrollment and intake context", async () => {
    classroomRepository.findEnrollmentContext.mockResolvedValue(enrollment());
    classroomRepository.findVisibleSessions.mockResolvedValue([curriculumSession()]);
    classroomRepository.createCompletion.mockResolvedValue({ id: "completion", enrollmentId, courseSessionId });
    await expect(completeClassroomSessionService(enrollmentId, courseSessionId, { id: userId, role: "STUDENT" })).resolves.toMatchObject({ created: true });
    expect(classroomRepository.createCompletion).toHaveBeenCalledWith(enrollmentId, courseSessionId, intakeId);

    classroomRepository.findVisibleSessions.mockResolvedValue([curriculumSession(true)]);
    await expect(completeClassroomSessionService(enrollmentId, courseSessionId, { id: userId, role: "STUDENT" })).resolves.toMatchObject({ created: false });
    expect(classroomRepository.createCompletion).toHaveBeenCalledTimes(1);
  });

  it("keeps completed enrollment learning history readable", async () => {
    classroomRepository.findEnrollmentContext.mockResolvedValue(enrollment({ status: "COMPLETED", intake: intake(false, { status: "COMPLETED" }) }));
    classroomRepository.findVisibleSessions.mockResolvedValue([curriculumSession(true)]);
    const result = await getClassroomService(enrollmentId, { id: userId, role: "STUDENT" });
    expect(result.enrollment.status).toBe("COMPLETED");
    expect(result.sessions[0].completed).toBe(true);
  });

  it.each([["complete", completeClassroomSessionService], ["uncomplete", uncompleteClassroomSessionService]])("freezes %s after enrollment completion", async (_name, mutate) => {
    classroomRepository.findEnrollmentContext.mockResolvedValue(enrollment({ status: "COMPLETED" }));
    await expect(mutate(enrollmentId, courseSessionId, { id: userId, role: "STUDENT" })).rejects.toMatchObject({ statusCode: 409, code: "ENROLLMENT_COMPLETED" });
    expect(classroomRepository.findVisibleSessions).not.toHaveBeenCalled();
  });

  it("does not let an administrator alter student completion", async () => {
    await expect(completeClassroomSessionService(enrollmentId, courseSessionId, { id: "admin-id", role: "ADMIN" })).rejects.toThrow(/only students/i);
    expect(classroomRepository.findEnrollmentContext).not.toHaveBeenCalled();
  });
});
