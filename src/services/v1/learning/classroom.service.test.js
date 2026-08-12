import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/learning/classroom.repository.js", () => ({
  findEnrollmentContext: vi.fn(),
  findFreeSessions: vi.fn(),
  findPaidSessions: vi.fn(),
  findCompletion: vi.fn(),
  createCompletion: vi.fn(),
  removeCompletion: vi.fn(),
}));

vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as classroomRepo from "../../../repositories/v1/learning/classroom.repository.js";
import {
  completeClassroomSessionService,
  getClassroomService,
  getClassroomSessionService,
  uncompleteClassroomSessionService,
} from "./classroom.service.js";

const enrollmentId = "a0000000-0000-4000-8000-000000000001";
const userId = "a0000000-0000-4000-8000-000000000002";
const courseId = "a0000000-0000-4000-8000-000000000003";
const courseSessionId = "a0000000-0000-4000-8000-000000000004";

function course(serviceType) {
  return {
    id: courseId,
    title: "Course",
    slug: "course",
    summary: "Summary",
    level: "BEGINNER",
    durationValue: 1,
    durationUnit: "MONTH",
    accessType: serviceType === "FREE_LEARNING" ? "FREE" : "PAID",
    price: serviceType === "FREE_LEARNING" ? 0 : 1000,
    currency: "LKR",
    certificateEnabled: false,
    category: { serviceType },
  };
}

function enrollment(overrides = {}) {
  const serviceType = overrides.batchId === null ? "FREE_LEARNING" : "BOOTCAMPS";
  return {
    id: enrollmentId,
    userId,
    courseId,
    batchId: "a0000000-0000-4000-8000-000000000005",
    source: "ADMIN",
    status: "ACTIVE",
    paymentStatus: "COMPLETED",
    user: { id: userId, emailVerified: true },
    course: course(serviceType),
    batch: { id: "batch", status: "ACTIVE", name: "Batch", code: "BATCH" },
    ...overrides,
  };
}

function curriculumSession(completed = false) {
  return {
    id: courseSessionId,
    orderIndex: 0,
    session: {
      title: "Session 1",
      description: "Lesson",
      recordingUrl: "https://example.com/recording",
      materialUrl: null,
      quizUrl: null,
      feedbackUrl: null,
      durationMinutes: 60,
      status: "READY",
    },
    completions: completed
      ? [{ id: "completion", completedAt: new Date() }]
      : [],
  };
}

describe("unified classroom service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses active curriculum for a Free Learning enrollment", async () => {
    classroomRepo.findEnrollmentContext.mockResolvedValue(
      enrollment({
        batchId: null,
        batch: null,
        source: "SELF",
        paymentStatus: "NOT_REQUIRED",
        course: course("FREE_LEARNING"),
      }),
    );
    classroomRepo.findFreeSessions.mockResolvedValue([
      curriculumSession(true),
      { ...curriculumSession(false), id: "second" },
    ]);

    const result = await getClassroomService(enrollmentId, {
      id: userId,
      role: "STUDENT",
    });
    expect(result.enrollment.deliveryMode).toBe("SELF_PACED");
    expect(result.progress).toMatchObject({
      completedCount: 1,
      availableSessionCount: 2,
      progressPercent: 50,
    });
    expect(classroomRepo.findPaidSessions).not.toHaveBeenCalled();
  });

  it("blocks paid classroom access until payment is completed", async () => {
    classroomRepo.findEnrollmentContext.mockResolvedValue(
      enrollment({ paymentStatus: "PARTIAL" }),
    );
    await expect(
      getClassroomService(enrollmentId, { id: userId, role: "STUDENT" }),
    ).rejects.toThrow(/payment must be completed/i);
  });

  it("isolates a classroom from another student's enrollment", async () => {
    classroomRepo.findEnrollmentContext.mockResolvedValue(enrollment());
    await expect(
      getClassroomService(enrollmentId, {
        id: "another-user",
        role: "STUDENT",
      }),
    ).rejects.toThrow(/do not have access/i);
  });

  it("does not expose a session absent from the resolved delivery", async () => {
    classroomRepo.findEnrollmentContext.mockResolvedValue(enrollment());
    classroomRepo.findPaidSessions.mockResolvedValue([]);
    await expect(
      getClassroomSessionService(enrollmentId, courseSessionId, {
        id: userId,
        role: "STUDENT",
      }),
    ).rejects.toThrow(/not available/i);
  });

  it("creates one contextual completion and returns existing completion idempotently", async () => {
    classroomRepo.findEnrollmentContext.mockResolvedValue(enrollment());
    classroomRepo.findPaidSessions.mockResolvedValue([
      {
        courseSession: curriculumSession(false),
        orderIndex: 0,
        availableAt: null,
      },
    ]);
    classroomRepo.createCompletion.mockResolvedValue({
      id: "completion",
      enrollmentId,
      courseSessionId,
    });

    const created = await completeClassroomSessionService(
      enrollmentId,
      courseSessionId,
      { id: userId, role: "STUDENT" },
    );
    expect(created.created).toBe(true);
    expect(classroomRepo.createCompletion).toHaveBeenCalledWith(
      enrollmentId,
      courseSessionId,
      courseId,
    );

    classroomRepo.findPaidSessions.mockResolvedValue([
      {
        courseSession: curriculumSession(true),
        orderIndex: 0,
        availableAt: null,
      },
    ]);
    const existing = await completeClassroomSessionService(
      enrollmentId,
      courseSessionId,
      { id: userId, role: "STUDENT" },
    );
    expect(existing.created).toBe(false);
    expect(classroomRepo.createCompletion).toHaveBeenCalledTimes(1);
  });

  it("keeps a completed enrollment classroom readable", async () => {
    classroomRepo.findEnrollmentContext.mockResolvedValue(
      enrollment({ status: "COMPLETED" }),
    );
    classroomRepo.findPaidSessions.mockResolvedValue([
      {
        courseSession: curriculumSession(true),
        orderIndex: 0,
        availableAt: null,
      },
    ]);

    const result = await getClassroomService(enrollmentId, {
      id: userId,
      role: "STUDENT",
    });

    expect(result.enrollment.status).toBe("COMPLETED");
    expect(result.sessions[0].completed).toBe(true);
  });

  it.each([
    ["complete", completeClassroomSessionService],
    ["uncomplete", uncompleteClassroomSessionService],
  ])("freezes %s after the enrollment is completed", async (_name, mutate) => {
    classroomRepo.findEnrollmentContext.mockResolvedValue(
      enrollment({ status: "COMPLETED" }),
    );

    await expect(
      mutate(enrollmentId, courseSessionId, {
        id: userId,
        role: "STUDENT",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "ENROLLMENT_COMPLETED",
    });
    expect(classroomRepo.findPaidSessions).not.toHaveBeenCalled();
    expect(classroomRepo.createCompletion).not.toHaveBeenCalled();
    expect(classroomRepo.removeCompletion).not.toHaveBeenCalled();
  });

  it("does not let an administrator change student session completion", async () => {
    await expect(
      completeClassroomSessionService(enrollmentId, courseSessionId, {
        id: "admin-id",
        role: "ADMIN",
      }),
    ).rejects.toThrow(/only students/i);
    expect(classroomRepo.findEnrollmentContext).not.toHaveBeenCalled();
    expect(classroomRepo.createCompletion).not.toHaveBeenCalled();
  });
});
