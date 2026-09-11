import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    category: { findUnique: vi.fn(), update: vi.fn() },
    course: { findMany: vi.fn(), updateMany: vi.fn() },
    intake: { count: vi.fn() },
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
    mocks.transaction.course.findMany.mockResolvedValue([{ id: "course-b" }, { id: "course-a" }]);
  });

  it("locks the category and every course before checking active intakes", async () => {
    mocks.transaction.intake.count.mockResolvedValue(1);
    await expect(archiveSafely(categoryId)).rejects.toMatchObject({ code: "CATALOG_ARCHIVE_BLOCKED" });
    expect(mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key)).toEqual([
      "learning-service:service-1",
      `catalog-category:${categoryId}`, "course:course-b", "course:course-a",
    ]);
    expect(mocks.transaction.category.update).not.toHaveBeenCalled();
  });

  it("archives internal courses and the category without deleting intakes", async () => {
    mocks.transaction.intake.count.mockResolvedValue(0);
    mocks.transaction.course.updateMany.mockResolvedValue({ count: 2 });
    mocks.transaction.category.update.mockResolvedValue({ id: categoryId, status: "ARCHIVED", _count: { courses: 2, intakes: 3 } });
    const result = await archiveSafely(categoryId);
    expect(result).toMatchObject({ archivedCourseCount: 2, category: { status: "ARCHIVED" } });
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
