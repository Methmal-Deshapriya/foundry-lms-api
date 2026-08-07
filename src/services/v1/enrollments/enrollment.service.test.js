import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/enrollments/enrollment.repository.js", () => ({
  createPaid: vi.fn(),
  createFree: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  findPaid: vi.fn(),
  findFree: vi.fn(),
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
import {
  bulkEnrollStudentsInBatchService,
  enrollStudentInBatchService,
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
    certificateEnabled: false,
    status: "PUBLISHED",
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
    enrollmentRepo.findFree.mockResolvedValue(existing);

    const result = await selfEnrollFreeCourseService(courseId, {
      id: userId,
      role: "STUDENT",
    });

    expect(result.created).toBe(false);
    expect(enrollmentRepo.createFree).not.toHaveBeenCalled();
  });

  it("resolves concurrent Free Learning insertion conflicts as idempotent success", async () => {
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
    enrollmentRepo.findFree
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existing);
    enrollmentRepo.createFree.mockRejectedValue(new ConflictError());

    const result = await selfEnrollFreeCourseService(courseId, {
      id: userId,
      role: "STUDENT",
    });
    expect(result.created).toBe(false);
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
});
