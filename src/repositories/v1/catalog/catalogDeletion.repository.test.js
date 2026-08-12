import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("../../../utils/prisma.js", () => ({
  default: { $transaction: mocks.transaction },
}));

import {
  CatalogDeletionBlockedError,
  ConflictError,
} from "../../../utils/Errors.js";
import { removePermanently as removeCategory } from "./category.repository.js";
import { removePermanently as removeCourse } from "./course.repository.js";

function createTransaction() {
  return {
    category: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({}),
    },
    course: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([{ id: "course-1" }]),
      count: vi.fn().mockResolvedValue(0),
      delete: vi.fn().mockResolvedValue({}),
    },
    courseSession: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "link-1",
          session: { id: "single-1", reusePolicy: "SINGLE_COURSE" },
        },
        {
          id: "link-2",
          session: { id: "shared-1", reusePolicy: "REUSABLE" },
        },
      ]),
      count: vi.fn(({ where }) =>
        Promise.resolve(where.session?.reusePolicy ? 1 : 2),
      ),
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    batch: {
      count: vi.fn(({ where }) =>
        Promise.resolve(where.status?.in ? 0 : 1),
      ),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    batchSession: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
    sessionCompletion: { count: vi.fn().mockResolvedValue(0) },
    certificate: { count: vi.fn().mockResolvedValue(0) },
    studentProject: {
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    enrollment: {
      count: vi.fn().mockResolvedValue(0),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    session: { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
}

describe("protected permanent catalog deletion transactions", () => {
  let transaction;

  beforeEach(() => {
    vi.clearAllMocks();
    transaction = createTransaction();
    mocks.transaction.mockImplementation((callback) => callback(transaction));
  });

  it("deletes an unused archived category graph in one serializable transaction", async () => {
    await expect(removeCategory("category-1")).resolves.toEqual({
      id: "category-1",
      deletedCourses: 1,
      deletedBatches: 1,
      deletedBatchSessions: 2,
      deletedCourseSessions: 2,
      deletedExclusiveSessions: 1,
      preservedReusableSessions: 1,
      deletedEnrollments: 0,
      deletedCompletions: 0,
      deletedCertificates: 0,
      deletedProjects: 0,
    });

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
    expect(transaction.course.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["course-1"] }, status: "ARCHIVED" },
      data: { status: "ARCHIVED" },
    });
    expect(transaction.category.delete).toHaveBeenCalledWith({
      where: { id: "category-1" },
    });
  });

  it("deletes an unused archived course while preserving reusable sessions", async () => {
    await expect(removeCourse("course-1")).resolves.toEqual({
      id: "course-1",
      deletedCourses: 1,
      deletedBatches: 1,
      deletedBatchSessions: 2,
      deletedCourseSessions: 2,
      deletedExclusiveSessions: 1,
      preservedReusableSessions: 1,
      deletedEnrollments: 0,
      deletedCompletions: 0,
      deletedCertificates: 0,
      deletedProjects: 0,
    });

    expect(transaction.enrollment.deleteMany).toHaveBeenCalled();
    expect(transaction.session.deleteMany).toHaveBeenCalled();
    expect(transaction.course.delete).toHaveBeenCalledWith({
      where: { id: "course-1" },
    });
  });

  it("blocks enrolling or active batches even when they have no enrollments", async () => {
    transaction.batch.count.mockImplementation(({ where }) =>
      Promise.resolve(where.status?.in ? 1 : 1),
    );

    const error = await removeCourse("course-1").catch((caught) => caught);

    expect(error).toBeInstanceOf(CatalogDeletionBlockedError);
    expect(error.code).toBe("CATALOG_DELETION_BLOCKED");
    expect(error.details.summary.operationalBatches).toBe(1);
    expect(error.details.blockers).toContainEqual(
      expect.objectContaining({ code: "OPERATIONAL_BATCHES" }),
    );
    expect(transaction.batch.count).toHaveBeenCalledWith({
      where: {
        courseId: { in: ["course-1"] },
        status: { in: ["ENROLLING", "ACTIVE"] },
      },
    });
    expect(transaction.course.delete).not.toHaveBeenCalled();
  });

  it("applies the operational-batch guard across every course in a category", async () => {
    transaction.batch.count.mockImplementation(({ where }) =>
      Promise.resolve(where.status?.in ? 2 : 3),
    );

    const error = await removeCategory("category-1").catch((caught) => caught);

    expect(error).toBeInstanceOf(CatalogDeletionBlockedError);
    expect(error.details.resourceType).toBe("CATEGORY");
    expect(error.details.summary.operationalBatches).toBe(2);
    expect(transaction.category.delete).not.toHaveBeenCalled();
  });

  it("protects enrollment history regardless of enrollment status", async () => {
    transaction.enrollment.count.mockResolvedValue(1);

    const error = await removeCourse("course-1").catch((caught) => caught);

    expect(error).toBeInstanceOf(CatalogDeletionBlockedError);
    expect(error.details.blockers).toContainEqual(
      expect.objectContaining({ code: "ENROLLMENT_HISTORY", count: 1 }),
    );
    expect(transaction.enrollment.deleteMany).not.toHaveBeenCalled();
  });

  it("protects completion, certificate, and project history independently", async () => {
    transaction.sessionCompletion.count.mockResolvedValue(2);
    transaction.certificate.count.mockResolvedValue(1);
    transaction.studentProject.count.mockResolvedValue(3);

    const error = await removeCourse("course-1").catch((caught) => caught);

    expect(error.details.blockers.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "COMPLETION_HISTORY",
        "CERTIFICATE_HISTORY",
        "PROJECT_HISTORY",
      ]),
    );
    expect(transaction.studentProject.deleteMany).not.toHaveBeenCalled();
  });

  it("applies the same history guard to category deletion", async () => {
    transaction.enrollment.count.mockResolvedValue(4);

    const error = await removeCategory("category-1").catch((caught) => caught);

    expect(error).toBeInstanceOf(CatalogDeletionBlockedError);
    expect(error.details.resourceType).toBe("CATEGORY");
    expect(error.details.summary.enrollments).toBe(4);
    expect(transaction.category.delete).not.toHaveBeenCalled();
  });

  it("refuses permanent deletion when the archived-course lock fails", async () => {
    transaction.course.updateMany.mockResolvedValue({ count: 0 });

    await expect(removeCourse("course-1")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(transaction.studentProject.deleteMany).not.toHaveBeenCalled();
  });

  it("retries a serialization conflict before deleting", async () => {
    mocks.transaction
      .mockRejectedValueOnce({ code: "P2034" })
      .mockImplementation((callback) => callback(transaction));

    await expect(removeCourse("course-1")).resolves.toMatchObject({
      id: "course-1",
      deletedCourses: 1,
    });
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
  });
});
