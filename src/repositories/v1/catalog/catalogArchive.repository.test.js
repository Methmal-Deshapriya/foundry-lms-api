import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    category: { findUnique: vi.fn(), update: vi.fn() },
    courseGroup: { findMany: vi.fn(), updateMany: vi.fn() },
    course: { count: vi.fn() },
  };
  return { transaction, prisma: { $transaction: vi.fn(async (callback) => callback(transaction)) } };
});
vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { archiveSafely, setPublication, updateOperational } from "./category.repository.js";

const categoryId = "90000000-0000-4000-8000-000000000020";

describe("category archive transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    mocks.transaction.category.findUnique
      .mockResolvedValueOnce({ serviceId: "service-1" })
      .mockResolvedValue({ id: categoryId, status: "PUBLISHED", service: { status: "ACTIVE" } });
    mocks.transaction.courseGroup.findMany.mockResolvedValue([{ id: "group-b" }, { id: "group-a" }]);
  });

  it("locks the category and every group before checking active intakes", async () => {
    mocks.transaction.course.count.mockResolvedValue(1);
    await expect(archiveSafely(categoryId)).rejects.toMatchObject({ code: "CATALOG_ARCHIVE_BLOCKED" });
    expect(mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key)).toEqual([
      "learning-service:service-1",
      `catalog-category:${categoryId}`, "course-group:group-b", "course-group:group-a",
    ]);
    expect(mocks.transaction.category.update).not.toHaveBeenCalled();
  });

  it("archives internal groups and the category without deleting courses", async () => {
    mocks.transaction.course.count.mockResolvedValue(0);
    mocks.transaction.courseGroup.updateMany.mockResolvedValue({ count: 2 });
    mocks.transaction.category.update.mockResolvedValue({ id: categoryId, status: "ARCHIVED", _count: { courses: 3, courseGroups: 2 } });
    const result = await archiveSafely(categoryId);
    expect(result).toMatchObject({ archivedCourseGroupCount: 2, category: { status: "ARCHIVED" } });
  });

  it("does not let a stale publish overwrite an archive", async () => {
    mocks.transaction.category.findUnique
      .mockReset()
      .mockResolvedValueOnce({ serviceId: "service-1" })
      .mockResolvedValue({ id: categoryId, status: "ARCHIVED", service: { status: "ACTIVE" } });
    await expect(setPublication(categoryId, true)).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("keeps category service identity immutable", async () => {
    await expect(updateOperational(categoryId, { serviceId: "service-2" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
