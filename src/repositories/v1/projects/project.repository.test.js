import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    studentProject: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    enrollment: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
      studentProject: { findFirst: vi.fn() },
    },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import {
  createForEnrollment,
  findPublicById,
  review,
  updatePendingOwned,
} from "./project.repository.js";

describe("project repository security boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  it("projects only explicitly public fields for an approved showcase detail", async () => {
    mocks.prisma.studentProject.findFirst.mockResolvedValue(null);
    await findPublicById("project-1");

    const query = mocks.prisma.studentProject.findFirst.mock.calls[0][0];
    expect(query.where).toEqual({
      id: "project-1",
      status: "APPROVED",
      isPublic: true,
    });
    expect(query.select).toMatchObject({
      id: true,
      title: true,
      user: { select: { firstName: true, lastName: true } },
      course: { select: { title: true } },
    });
    for (const privateField of [
      "userId",
      "courseId",
      "enrollmentId",
      "reviewedBy",
      "adminFeedback",
    ]) {
      expect(query.select).not.toHaveProperty(privateField);
    }
  });

  it("rejects a student edit when review won the shared project lock", async () => {
    mocks.transaction.studentProject.findUnique.mockResolvedValue({
      id: "project-1",
      userId: "student-1",
      status: "APPROVED",
    });

    await expect(
      updatePendingOwned("project-1", "student-1", { title: "Changed" }),
    ).rejects.toMatchObject({ code: "PROJECT_REVIEW_STATE_CHANGED" });
    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("pg_advisory_xact_lock"),
      "project:project-1",
    );
    expect(mocks.transaction.studentProject.update).not.toHaveBeenCalled();
  });

  it("serializes administrative review on the same project lock", async () => {
    mocks.transaction.studentProject.findUnique.mockResolvedValue({
      id: "project-1",
      title: "Reviewed content",
    });
    mocks.transaction.studentProject.update.mockResolvedValue({
      id: "project-1",
      status: "APPROVED",
    });

    const result = await review("project-1", { status: "APPROVED" });

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      "project:project-1",
    );
    expect(result.previous.title).toBe("Reviewed content");
    expect(result.project.status).toBe("APPROVED");
  });

  it("locks and rechecks enrollment ownership before project submission", async () => {
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ courseId: "course-1", course: { category: { serviceId: "service-paid" } } })
      .mockResolvedValue({
        id: "enrollment-1",
        userId: "student-1",
        courseId: "course-1",
        source: "ADMIN",
        status: "ACTIVE",
        paymentStatus: "COMPLETED",
        course: { status: "OPEN_ACTIVE", category: { service: { accessType: "PAID", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" } } },
      });
    mocks.transaction.user.findUnique.mockResolvedValue({
      id: "student-1",
      role: "STUDENT",
      emailVerified: true,
    });
    mocks.transaction.studentProject.create.mockResolvedValue({ id: "project-1" });

    await createForEnrollment(
      { id: "student-1", role: "STUDENT" },
      {
        enrollmentId: "enrollment-1",
        courseId: "course-1",
        userId: "student-1",
        title: "Project",
      },
    );

    const lockKeys = mocks.transaction.$queryRawUnsafe.mock.calls.map(
      ([, key]) => key,
    );
    expect(lockKeys).toEqual([
      "learning-service:service-paid",
      "course:course-1",
      "enrollment:enrollment-1",
    ]);
    expect(mocks.transaction.studentProject.create).toHaveBeenCalledTimes(1);
  });

  it("rejects submission when cancellation won the enrollment lock", async () => {
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ courseId: "course-1", course: { category: { serviceId: "service-free" } } })
      .mockResolvedValue({
        userId: "student-1",
        courseId: "course-1",
        source: "SELF",
        status: "CANCELLED",
        paymentStatus: "NOT_REQUIRED",
        course: { status: "OPEN_ACTIVE", category: { service: { accessType: "FREE", enrollmentMode: "SELF", paymentRequirement: "NOT_REQUIRED" } } },
      });
    mocks.transaction.user.findUnique.mockResolvedValue({
      id: "student-1",
      role: "STUDENT",
      emailVerified: true,
    });

    await expect(
      createForEnrollment(
        { id: "student-1", role: "STUDENT" },
        {
          enrollmentId: "enrollment-1",
          courseId: "course-1",
          userId: "student-1",
          title: "Project",
        },
      ),
    ).rejects.toThrow(/does not allow/i);
    expect(mocks.transaction.studentProject.create).not.toHaveBeenCalled();
  });
});
