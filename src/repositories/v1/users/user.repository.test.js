import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("../../../utils/prisma.js", () => ({
  default: { user: { findMany: mocks.findMany } },
}));

import { searchEligibleStudents } from "../enrollments/enrollment.repository.js";

describe("eligible student repository search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses deterministic keyset ordering and a look-ahead row", async () => {
    mocks.findMany.mockResolvedValue([]);

    await searchEligibleStudents("course-1", "alex", 25, null);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ email: "asc" }, { id: "asc" }],
      take: 26,
      select: { id: true, firstName: true, lastName: true, email: true },
      where: expect.objectContaining({
        role: "STUDENT",
        emailVerified: true,
        enrollments: { none: { intakeId: "course-1" } },
        AND: [{ OR: expect.any(Array) }],
      }),
    }));
  });

  it("continues after the complete email and id cursor", async () => {
    mocks.findMany.mockResolvedValue([]);

    await searchEligibleStudents("course-1", "", 2, {
      email: "alex@example.com",
      id: "90000000-0000-4000-8000-000000000010",
    });

    const query = mocks.findMany.mock.calls[0][0];
    expect(query.take).toBe(3);
    expect(query.where.AND).toEqual([
      {
        OR: [
          { email: { gt: "alex@example.com" } },
          {
            email: "alex@example.com",
            id: { gt: "90000000-0000-4000-8000-000000000010" },
          },
        ],
      },
    ]);
  });

  it("keeps both the search filter and the cursor filter when paginating a search", async () => {
    mocks.findMany.mockResolvedValue([]);

    await searchEligibleStudents("course-1", "alex", 2, {
      email: "alex@example.com",
      id: "90000000-0000-4000-8000-000000000010",
    });

    const query = mocks.findMany.mock.calls[0][0];
    // Regression check: q's OR-group and the cursor's OR-group must both
    // survive under AND — a bare object-spread of two "OR" keys would let
    // the cursor clause silently replace the search clause.
    expect(query.where.AND).toHaveLength(2);
    expect(query.where.AND[0]).toEqual({
      OR: [
        { email: { contains: "alex", mode: "insensitive" } },
        { firstName: { contains: "alex", mode: "insensitive" } },
        { lastName: { contains: "alex", mode: "insensitive" } },
      ],
    });
    expect(query.where.AND[1]).toEqual({
      OR: [
        { email: { gt: "alex@example.com" } },
        {
          email: "alex@example.com",
          id: { gt: "90000000-0000-4000-8000-000000000010" },
        },
      ],
    });
  });
});
