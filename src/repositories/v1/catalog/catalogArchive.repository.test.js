import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    batch: { count: vi.fn() },
    category: { findUnique: vi.fn(), update: vi.fn() },
    course: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import {
  archiveSafely as archiveCategory,
  setPublication as setCategoryPublication,
  updateOperational as updateCategoryOperational,
} from "./category.repository.js";
import {
  archiveSafely as archiveCourse,
  setPublication as setCoursePublication,
  updateOperational as updateCourseOperational,
} from "./course.repository.js";

const categoryId = "90000000-0000-4000-8000-000000000020";
const courseId = "90000000-0000-4000-8000-000000000021";

describe("catalog archive transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  it("blocks course archival while an enrolling batch exists", async () => {
    mocks.transaction.course.findUnique.mockResolvedValue({
      id: courseId,
      status: "PUBLISHED",
      category: { status: "PUBLISHED" },
      _count: { courseSessions: 2, batches: 1, enrollments: 1 },
    });
    mocks.transaction.batch.count.mockResolvedValue(1);

    await expect(archiveCourse(courseId)).rejects.toMatchObject({
      code: "CATALOG_ARCHIVE_BLOCKED",
    });
    expect(mocks.transaction.course.update).not.toHaveBeenCalled();
  });

  it("locks every child curriculum and blocks category archival for enrolling batches", async () => {
    mocks.transaction.category.findUnique.mockResolvedValue({
      status: "PUBLISHED",
      courses: [{ id: courseId }, { id: `${courseId}-2` }],
    });
    mocks.transaction.batch.count.mockResolvedValue(1);

    await expect(archiveCategory(categoryId)).rejects.toMatchObject({
      code: "CATALOG_ARCHIVE_BLOCKED",
    });
    const lockKeys = mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key);
    expect(lockKeys).toEqual([
      `catalog-category:${categoryId}`,
      `curriculum:${courseId}`,
      `curriculum:${courseId}-2`,
    ]);
    expect(mocks.transaction.course.updateMany).not.toHaveBeenCalled();
    expect(mocks.transaction.category.update).not.toHaveBeenCalled();
  });

  it("archives the category graph when no enrolling batch exists", async () => {
    mocks.transaction.category.findUnique.mockResolvedValue({
      status: "PUBLISHED",
      courses: [{ id: courseId }],
    });
    mocks.transaction.batch.count.mockResolvedValue(0);
    mocks.transaction.course.updateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.category.update.mockResolvedValue({
      id: categoryId,
      status: "ARCHIVED",
      title: "Machine Learning",
      _count: { courses: 1 },
    });

    const result = await archiveCategory(categoryId);

    expect(result.archivedCourseCount).toBe(1);
    expect(result.category.status).toBe("ARCHIVED");
  });

  it("does not let a stale category publish overwrite a completed archive", async () => {
    mocks.transaction.category.findUnique.mockResolvedValue({
      id: categoryId,
      status: "ARCHIVED",
    });

    await expect(setCategoryPublication(categoryId, true)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      `catalog-category:${categoryId}`,
    );
    expect(mocks.transaction.category.update).not.toHaveBeenCalled();
  });

  it("does not let a stale course publish overwrite a completed archive", async () => {
    mocks.transaction.course.findUnique.mockResolvedValue({
      id: courseId,
      status: "ARCHIVED",
      category: { status: "PUBLISHED", serviceType: "BOOTCAMPS" },
    });

    await expect(setCoursePublication(courseId, true)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      `curriculum:${courseId}`,
    );
    expect(mocks.transaction.course.update).not.toHaveBeenCalled();
  });

  it("enforces category service identity inside the write transaction", async () => {
    mocks.transaction.category.findUnique.mockResolvedValue({
      id: categoryId,
      status: "DRAFT",
      serviceType: "BOOTCAMPS",
    });

    await expect(
      updateCategoryOperational(categoryId, { serviceType: "FREE_LEARNING" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.transaction.category.update).not.toHaveBeenCalled();
  });

  it("enforces course category identity inside the write transaction", async () => {
    mocks.transaction.course.findUnique.mockResolvedValue({
      id: courseId,
      status: "DRAFT",
      category: { status: "PUBLISHED", serviceType: "BOOTCAMPS" },
    });

    await expect(
      updateCourseOperational(courseId, { categoryId: categoryId }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.transaction.course.update).not.toHaveBeenCalled();
  });
});
