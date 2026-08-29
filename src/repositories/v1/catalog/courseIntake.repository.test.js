import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    courseGroup: { findUnique: vi.fn() },
    course: { findUnique: vi.fn(), create: vi.fn() },
    courseSession: { findMany: vi.fn(), createMany: vi.fn() },
    enrollment: { count: vi.fn() },
  };
  return {
    transaction,
    prisma: { $transaction: vi.fn(async (operation) => operation(transaction)) },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { create, updateSetup } from "./course.repository.js";

const courseId = "20000000-0000-4000-8000-000000000001";
const groupId = "20000000-0000-4000-8000-000000000002";
const categoryId = "20000000-0000-4000-8000-000000000003";

describe("course intake repository invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  it("rechecks under the group lock that a later intake has a source course", async () => {
    mocks.transaction.courseGroup.findUnique
      .mockResolvedValueOnce({ category: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({
        id: groupId,
        categoryId,
        archivedAt: null,
        category: { status: "PUBLISHED", service: { status: "ACTIVE", courseMode: "SEASONAL" } },
        courses: [{ id: "existing-course" }],
      });

    await expect(create({
      id: courseId,
      courseGroupId: groupId,
      categoryId,
    })).rejects.toMatchObject({ code: "COURSE_SOURCE_REQUIRED", statusCode: 409 });
    expect(mocks.transaction.course.create).not.toHaveBeenCalled();
  });

  it("copies curriculum into independent rows owned by the new intake", async () => {
    const newCourse = { id: courseId };
    mocks.transaction.courseGroup.findUnique
      .mockResolvedValueOnce({ category: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({
        id: groupId,
        categoryId,
        archivedAt: null,
        category: { status: "PUBLISHED", service: { status: "ACTIVE", courseMode: "SEASONAL" } },
        courses: [{ id: "source-course" }],
      });
    mocks.transaction.course.findUnique.mockResolvedValue({ id: "source-course" });
    mocks.transaction.course.findFirst = vi.fn().mockResolvedValue({ id: "source-course" });
    mocks.transaction.course.create.mockResolvedValue(newCourse);
    mocks.transaction.courseSession.findMany.mockResolvedValue([
      { sessionId: "30000000-0000-4000-8000-000000000001", orderIndex: 0 },
      { sessionId: "30000000-0000-4000-8000-000000000002", orderIndex: 1 },
    ]);

    await create({ id: courseId, courseGroupId: groupId, categoryId }, "source-course");

    expect(mocks.transaction.courseSession.createMany).toHaveBeenCalledWith({
      data: [
        { courseId, sessionId: "30000000-0000-4000-8000-000000000001", orderIndex: 0, deliveryStatus: "UNRELEASED" },
        { courseId, sessionId: "30000000-0000-4000-8000-000000000002", orderIndex: 1, deliveryStatus: "UNRELEASED" },
      ],
    });
  });

  it("does not reduce capacity below the current non-cancelled learner count", async () => {
    mocks.transaction.course.findUnique
      .mockResolvedValueOnce({ categoryId, courseGroupId: groupId, category: { serviceId: "service-paid" } })
      .mockResolvedValueOnce({ id: courseId, status: "OPEN_ACTIVE" });
    mocks.transaction.enrollment.count.mockResolvedValue(8);

    await expect(updateSetup(courseId, { capacity: 7 })).rejects.toMatchObject({
      code: "COURSE_CAPACITY_BELOW_ENROLLMENT_COUNT",
      statusCode: 409,
    });
  });
});
