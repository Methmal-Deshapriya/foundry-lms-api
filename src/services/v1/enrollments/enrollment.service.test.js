import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BatchCapacityReachedError,
  ConflictError,
} from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/enrollments/enrollment.repository.js", () => ({
  createPaid: vi.fn(),
  enrollFree: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  findPaid: vi.fn(),
  findUserEnrollments: vi.fn(),
  findBatchEnrollments: vi.fn(),
  findCourseEnrollments: vi.fn(),
}));

vi.mock("../../../repositories/v1/users/user.repository.js", () => ({
  findUserById: vi.fn(),
  findVerifiedStudentsByIds: vi.fn(),
  searchEligibleStudentsForBatch: vi.fn(),
}));

vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({
  findById: vi.fn(),
  findPublishedFreeById: vi.fn(),
}));

vi.mock("../../../repositories/v1/batches/batch.repository.js", () => ({
  findById: vi.fn(),
}));

vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as enrollmentRepo from "../../../repositories/v1/enrollments/enrollment.repository.js";
import * as userRepo from "../../../repositories/v1/users/user.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import * as batchRepo from "../../../repositories/v1/batches/batch.repository.js";
import { recordActionService } from "../audit/audit.service.js";
import {
  bulkEnrollStudentsInBatchService,
  enrollStudentInBatchService,
  getEligibleStudentsForBatchService,
  selfEnrollFreeCourseService,
  updateEnrollmentService,
} from "./enrollment.service.js";

const actorId = "90000000-0000-4000-8000-000000000001";
const userId = "90000000-0000-4000-8000-000000000002";
const secondUserId = "90000000-0000-4000-8000-000000000003";
const courseId = "90000000-0000-4000-8000-000000000004";
const batchId = "90000000-0000-4000-8000-000000000005";

function courseFixture(serviceType = "BOOTCAMPS") {
  return {
    id: courseId,
    title: "Machine Learning 1",
    slug: "machine-learning-1",
    summary: "Summary",
    level: "BEGINNER",
    durationValue: 4,
    durationUnit: "MONTH",
    accessType: serviceType === "FREE_LEARNING" ? "FREE" : "PAID",
    price: serviceType === "FREE_LEARNING" ? 0 : 1000,
    currency: "LKR",
    enrollmentStatus: "OPEN",
    certificateEnabled: false,
    status: "PUBLISHED",
    _count: { courseSessions: 1 },
    category: { serviceType, status: "PUBLISHED" },
  };
}

function batchFixture(serviceType = "BOOTCAMPS") {
  return {
    id: batchId,
    courseId,
    name: "August 2026",
    code: "ML1-2026-AUG",
    status: "ENROLLING",
    course: courseFixture(serviceType),
  };
}

function studentFixture(id = userId) {
  return {
    id,
    email: `${id}@example.com`,
    firstName: "Test",
    lastName: "Student",
    role: "STUDENT",
    emailVerified: true,
  };
}

function enrollmentFixture(overrides = {}) {
  const course = courseFixture(overrides.source === "SELF" ? "FREE_LEARNING" : "BOOTCAMPS");
  return {
    id: "90000000-0000-4000-8000-000000000006",
    userId,
    courseId,
    batchId,
    source: "ADMIN",
    status: "ACTIVE",
    paymentStatus: "COMPLETED",
    paymentCompletedAt: new Date(),
    externalPaymentReference: null,
    paymentNote: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    user: studentFixture(),
    enrolledBy: null,
    course,
    batch: batchFixture(),
    ...overrides,
  };
}

describe("service-aware enrollment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("manually enrolls a verified student into a paid batch with completed payment by default", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture());
    userRepo.findUserById.mockResolvedValue(studentFixture());
    enrollmentRepo.createPaid.mockResolvedValue(enrollmentFixture());

    const result = await enrollStudentInBatchService(
      batchId,
      { userId },
      actorId,
    );

    expect(enrollmentRepo.createPaid).toHaveBeenCalledWith(
      batchId,
      userId,
      actorId,
      expect.objectContaining({
        paymentStatus: "COMPLETED",
        paymentCompletedAt: expect.any(Date),
      }),
    );
    expect(result.batchId).toBe(batchId);
  });

  it("rejects paid manual enrollment for Free Learning", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture("FREE_LEARNING"));
    userRepo.findUserById.mockResolvedValue(studentFixture());

    await expect(
      enrollStudentInBatchService(batchId, { userId }, actorId),
    ).rejects.toThrow(/only for cohort/i);
    expect(enrollmentRepo.createPaid).not.toHaveBeenCalled();
  });

  it("returns per-student bulk results without hiding duplicate failures", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture());
    userRepo.findVerifiedStudentsByIds.mockResolvedValue([
      studentFixture(),
      studentFixture(secondUserId),
    ]);
    enrollmentRepo.createPaid
      .mockResolvedValueOnce(enrollmentFixture())
      .mockRejectedValueOnce(new ConflictError("Student is already enrolled."));

    const result = await bulkEnrollStudentsInBatchService(
      batchId,
      { students: [{ userId }, { userId: secondUserId }] },
      actorId,
    );

    expect(result.summary).toEqual({ requested: 2, created: 1, failed: 1 });
    expect(result.results.map(({ status }) => status)).toEqual([
      "CREATED",
      "FAILED",
    ]);
  });

  it("stops opening transactions after capacity is authoritatively exhausted", async () => {
    const thirdUserId = "90000000-0000-4000-8000-000000000007";
    const ineligibleUserId = "90000000-0000-4000-8000-000000000008";
    batchRepo.findById.mockResolvedValue(batchFixture());
    userRepo.findVerifiedStudentsByIds.mockResolvedValue([
      studentFixture(userId),
      studentFixture(secondUserId),
      studentFixture(thirdUserId),
    ]);
    enrollmentRepo.createPaid.mockRejectedValueOnce(
      new BatchCapacityReachedError(),
    );

    const result = await bulkEnrollStudentsInBatchService(
      batchId,
      {
        students: [
          { userId },
          { userId: secondUserId },
          { userId: ineligibleUserId },
          { userId: thirdUserId },
        ],
      },
      actorId,
    );

    expect(enrollmentRepo.createPaid).toHaveBeenCalledTimes(1);
    expect(result.results).toEqual([
      expect.objectContaining({ userId, code: "BATCH_CAPACITY_REACHED" }),
      expect.objectContaining({ userId: secondUserId, code: "BATCH_CAPACITY_REACHED" }),
      expect.objectContaining({ userId: ineligibleUserId, code: "INELIGIBLE_STUDENT" }),
      expect.objectContaining({ userId: thirdUserId, code: "BATCH_CAPACITY_REACHED" }),
    ]);
    expect(result.summary).toEqual({ requested: 4, created: 0, failed: 4 });
  });

  it("makes Free Learning self-enrollment idempotent", async () => {
    const course = courseFixture("FREE_LEARNING");
    const existing = enrollmentFixture({
      batchId: null,
      batch: null,
      source: "SELF",
      paymentStatus: "NOT_REQUIRED",
      paymentCompletedAt: null,
      course,
    });
    courseRepo.findPublishedFreeById.mockResolvedValue(course);
    userRepo.findUserById.mockResolvedValue(studentFixture());
    enrollmentRepo.enrollFree.mockResolvedValue({
      enrollment: existing,
      outcome: "EXISTING",
    });

    const result = await selfEnrollFreeCourseService(courseId, {
      id: userId,
      role: "STUDENT",
    });

    expect(result.created).toBe(false);
    expect(result.reactivated).toBe(false);
    expect(recordActionService).not.toHaveBeenCalled();
  });

  it("reactivates the same cancelled Free Learning enrollment", async () => {
    const course = courseFixture("FREE_LEARNING");
    const reactivated = enrollmentFixture({
      batchId: null,
      batch: null,
      source: "SELF",
      status: "ACTIVE",
      paymentStatus: "NOT_REQUIRED",
      paymentCompletedAt: null,
      course,
    });
    courseRepo.findPublishedFreeById.mockResolvedValue(course);
    userRepo.findUserById.mockResolvedValue(studentFixture());
    enrollmentRepo.enrollFree.mockResolvedValue({
      enrollment: reactivated,
      outcome: "REACTIVATED",
    });

    const result = await selfEnrollFreeCourseService(courseId, {
      id: userId,
      role: "STUDENT",
    });
    expect(result.created).toBe(false);
    expect(result.reactivated).toBe(true);
    expect(result.enrollment.status).toBe("ACTIVE");
    expect(recordActionService).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "STUDENT_SELF_REENROLLED",
        entityId: reactivated.id,
        metadata: expect.objectContaining({
          outcome: "REACTIVATED",
          previousStatus: "CANCELLED",
          newStatus: "ACTIVE",
        }),
      }),
    );
  });

  it.each([
    ["COMING_SOON", /coming soon/i],
    ["CLOSED", /closed/i],
  ])("rejects Free Learning self-enrollment while availability is %s", async (status, message) => {
    courseRepo.findPublishedFreeById.mockResolvedValue({
      ...courseFixture("FREE_LEARNING"),
      enrollmentStatus: status,
    });
    userRepo.findUserById.mockResolvedValue(studentFixture());

    await expect(
      selfEnrollFreeCourseService(courseId, { id: userId, role: "STUDENT" }),
    ).rejects.toThrow(message);
    expect(enrollmentRepo.enrollFree).not.toHaveBeenCalled();
  });

  it("rejects Free Learning self-enrollment when an open course has no curriculum", async () => {
    courseRepo.findPublishedFreeById.mockResolvedValue({
      ...courseFixture("FREE_LEARNING"),
      _count: { courseSessions: 0 },
    });
    userRepo.findUserById.mockResolvedValue(studentFixture());

    await expect(
      selfEnrollFreeCourseService(courseId, { id: userId, role: "STUDENT" }),
    ).rejects.toThrow(/curriculum is still being prepared/i);
    expect(enrollmentRepo.enrollFree).not.toHaveBeenCalled();
  });

  it("does not allow payment mutations on free self-enrollments", async () => {
    enrollmentRepo.findById.mockResolvedValue(
      enrollmentFixture({ source: "SELF", batchId: null, batch: null }),
    );
    await expect(
      updateEnrollmentService(
        "90000000-0000-4000-8000-000000000006",
        { paymentStatus: "COMPLETED" },
        actorId,
      ),
    ).rejects.toThrow(/cannot be changed/i);
  });

  it("keeps cancelled free enrollment reactivation student-owned", async () => {
    enrollmentRepo.findById.mockResolvedValue(
      enrollmentFixture({
        source: "SELF",
        batchId: null,
        batch: null,
        status: "CANCELLED",
        paymentStatus: "NOT_REQUIRED",
        paymentCompletedAt: null,
      }),
    );

    await expect(
      updateEnrollmentService(
        "90000000-0000-4000-8000-000000000006",
        { status: "ACTIVE" },
        actorId,
      ),
    ).rejects.toThrow(/initiated by the student/i);
    expect(enrollmentRepo.update).not.toHaveBeenCalled();
  });

  it("does not complete a paid enrollment while payment is incomplete", async () => {
    enrollmentRepo.findById.mockResolvedValue(
      enrollmentFixture({ paymentStatus: "PARTIAL", paymentCompletedAt: null }),
    );
    await expect(
      updateEnrollmentService(
        "90000000-0000-4000-8000-000000000006",
        { status: "COMPLETED" },
        actorId,
      ),
    ).rejects.toThrow(/before payment is completed/i);
    expect(enrollmentRepo.update).not.toHaveBeenCalled();
  });

  it.each(["ACTIVE", "CANCELLED"])(
    "treats COMPLETED enrollment as terminal against %s",
    async (nextStatus) => {
      enrollmentRepo.findById.mockResolvedValue(
        enrollmentFixture({
          status: "COMPLETED",
          completedAt: new Date(),
        }),
      );

      await expect(
        updateEnrollmentService(
          "90000000-0000-4000-8000-000000000006",
          { status: nextStatus },
          actorId,
        ),
      ).rejects.toThrow(/terminal/i);
      expect(enrollmentRepo.update).not.toHaveBeenCalled();
    },
  );

  it("freezes payment status after a paid enrollment is completed", async () => {
    const completed = enrollmentFixture({
      status: "COMPLETED",
      paymentStatus: "COMPLETED",
      completedAt: new Date(),
    });
    enrollmentRepo.findById.mockResolvedValue(completed);

    await expect(
      updateEnrollmentService(
        completed.id,
        { paymentStatus: "PARTIAL" },
        actorId,
      ),
    ).rejects.toThrow(/payment status is frozen/i);
    expect(enrollmentRepo.update).not.toHaveBeenCalled();
  });

  it("does not rewrite the completion timestamp during a same-status correction", async () => {
    const completedAt = new Date("2026-08-12T10:00:00.000Z");
    const completed = enrollmentFixture({ status: "COMPLETED", completedAt });
    enrollmentRepo.findById.mockResolvedValue(completed);
    enrollmentRepo.update.mockResolvedValue({
      ...completed,
      paymentNote: "Reference corrected",
    });

    await updateEnrollmentService(
      completed.id,
      { status: "COMPLETED", paymentNote: "Reference corrected" },
      actorId,
    );

    expect(enrollmentRepo.update).toHaveBeenCalledWith(
      completed.id,
      {
        status: "COMPLETED",
        paymentStatus: "COMPLETED",
      },
      expect.not.objectContaining({ completedAt: expect.anything() }),
    );
  });

  it("allows an admin-managed cancelled paid enrollment to return to active", async () => {
    const cancelled = enrollmentFixture({
      status: "CANCELLED",
      completedAt: null,
    });
    const active = enrollmentFixture({ status: "ACTIVE", completedAt: null });
    enrollmentRepo.findById.mockResolvedValue(cancelled);
    enrollmentRepo.update.mockResolvedValue(active);

    const result = await updateEnrollmentService(
      cancelled.id,
      { status: "ACTIVE" },
      actorId,
    );

    expect(enrollmentRepo.update).toHaveBeenCalledWith(
      cancelled.id,
      {
        status: "CANCELLED",
        paymentStatus: "COMPLETED",
      },
      expect.objectContaining({ status: "ACTIVE", completedAt: null }),
    );
    expect(result.status).toBe("ACTIVE");
  });

  it("returns a stable next cursor when more eligible students exist", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture());
    const students = [
      studentFixture("90000000-0000-4000-8000-000000000010"),
      studentFixture("90000000-0000-4000-8000-000000000011"),
      studentFixture("90000000-0000-4000-8000-000000000012"),
    ];
    userRepo.searchEligibleStudentsForBatch.mockResolvedValue(students);

    const result = await getEligibleStudentsForBatchService(batchId, {
      q: "test",
      limit: "2",
    });

    expect(result.students).toEqual(students.slice(0, 2));
    expect(result.pagination).toMatchObject({ limit: 2, hasMore: true });
    expect(result.pagination.nextCursor).toEqual(expect.any(String));
    expect(userRepo.searchEligibleStudentsForBatch).toHaveBeenCalledWith(
      batchId,
      "test",
      2,
      null,
    );
  });

  it("decodes an eligible-student cursor before querying the next page", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture());
    userRepo.searchEligibleStudentsForBatch.mockResolvedValue([]);
    const cursorPayload = {
      batchId,
      q: "",
      email: "student@example.com",
      id: "90000000-0000-4000-8000-000000000010",
    };
    const cursor = Buffer.from(JSON.stringify(cursorPayload)).toString("base64url");

    const result = await getEligibleStudentsForBatchService(batchId, { cursor });

    expect(result.pagination).toEqual({
      limit: 25,
      hasMore: false,
      nextCursor: null,
    });
    expect(userRepo.searchEligibleStudentsForBatch).toHaveBeenCalledWith(
      batchId,
      "",
      25,
      expect.objectContaining({
        email: cursorPayload.email,
        id: cursorPayload.id,
      }),
    );
  });

  it("rejects malformed eligible-student cursors", async () => {
    batchRepo.findById.mockResolvedValue(batchFixture());

    await expect(
      getEligibleStudentsForBatchService(batchId, { cursor: "not-a-cursor" }),
    ).rejects.toMatchObject({ field: "cursor", statusCode: 400 });
    expect(userRepo.searchEligibleStudentsForBatch).not.toHaveBeenCalled();
  });
});
