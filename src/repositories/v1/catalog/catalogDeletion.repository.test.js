import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("../../../utils/prisma.js", () => ({
  default: { $transaction: mocks.transaction },
}));

import { ConflictError } from "../../../utils/Errors.js";
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
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      delete: vi.fn().mockResolvedValue({}),
    },
    studentProject: {
      deleteMany: vi.fn().mockResolvedValue({ count: 2 }),
    },
    enrollment: {
      deleteMany: vi.fn().mockResolvedValue({ count: 3 }),
    },
    session: {
      deleteMany: vi.fn().mockResolvedValue({ count: 4 }),
    },
  };
}

describe("permanent catalog deletion transactions", () => {
  let transaction;

  beforeEach(() => {
    vi.clearAllMocks();
    transaction = createTransaction();
    mocks.transaction.mockImplementation((callback) => callback(transaction));
  });

  it("deletes a category dependency graph before the category", async () => {
    await expect(removeCategory("category-1")).resolves.toEqual({
      id: "category-1",
      deletedCourses: 1,
      deletedSessions: 4,
      deletedEnrollments: 3,
      deletedProjects: 2,
    });

    expect(transaction.studentProject.deleteMany).toHaveBeenCalledWith({
      where: { courseId: { in: ["course-1"] } },
    });
    expect(transaction.enrollment.deleteMany).toHaveBeenCalled();
    expect(transaction.session.deleteMany).toHaveBeenCalled();
    expect(transaction.course.deleteMany).toHaveBeenCalled();
    expect(transaction.category.delete).toHaveBeenCalledWith({
      where: { id: "category-1" },
    });
  });

  it("deletes a course dependency graph before the course", async () => {
    await expect(removeCourse("course-1")).resolves.toEqual({
      id: "course-1",
      deletedCourses: 1,
      deletedSessions: 4,
      deletedEnrollments: 3,
      deletedProjects: 2,
    });

    expect(transaction.studentProject.deleteMany).toHaveBeenCalled();
    expect(transaction.enrollment.deleteMany).toHaveBeenCalled();
    expect(transaction.session.deleteMany).toHaveBeenCalled();
    expect(transaction.course.delete).toHaveBeenCalledWith({
      where: { id: "course-1" },
    });
  });

  it("refuses permanent deletion when the archived-row lock fails", async () => {
    transaction.course.updateMany.mockResolvedValue({ count: 0 });

    await expect(removeCourse("course-1")).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(transaction.studentProject.deleteMany).not.toHaveBeenCalled();
  });
});
