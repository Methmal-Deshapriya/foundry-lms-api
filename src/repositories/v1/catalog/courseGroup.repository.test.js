import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    courseGroup: {
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (operation) => operation(transaction)),
      courseGroup: { findUnique: vi.fn() },
    },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import {
  findDeletionImpact,
  setArchived,
  update,
} from "./courseGroup.repository.js";

const groupId = "10000000-0000-4000-8000-000000000001";
const categoryId = "10000000-0000-4000-8000-000000000002";

describe("course group repository invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  it("freezes the complete group identity after the first course exists", async () => {
    mocks.transaction.courseGroup.findUnique
      .mockResolvedValueOnce({ categoryId, category: { serviceId: "service-1" } })
      .mockResolvedValueOnce({ archivedAt: null, _count: { courses: 1 } });

    await expect(update(groupId, { title: "Renamed course" })).rejects.toMatchObject({
      code: "COURSE_GROUP_IDENTITY_LOCKED",
      statusCode: 409,
    });
    expect(mocks.transaction.courseGroup.update).not.toHaveBeenCalled();
  });

  it("does not restore a child group while its category remains archived", async () => {
    mocks.transaction.courseGroup.findUnique
      .mockResolvedValueOnce({ categoryId, category: { serviceId: "service-1" } })
      .mockResolvedValueOnce({
        category: { status: "ARCHIVED", service: { status: "ACTIVE" } },
        courses: [],
      });

    await expect(setArchived(groupId, false)).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.transaction.courseGroup.update).not.toHaveBeenCalled();
  });

  it("reports course and historical-use counts before permanent deletion", async () => {
    mocks.prisma.courseGroup.findUnique.mockResolvedValue({
      archivedAt: new Date(),
      _count: { courses: 2 },
      courses: [
        { _count: { enrollments: 3, courseSessions: 4, studentProjects: 1 } },
        { _count: { enrollments: 2, courseSessions: 5, studentProjects: 0 } },
      ],
    });

    await expect(findDeletionImpact(groupId)).resolves.toEqual({
      resourceType: "COURSE_GROUP",
      resourceId: groupId,
      resourceStatus: "ARCHIVED",
      courses: 2,
      history: 15,
      deletable: false,
    });
  });
});
