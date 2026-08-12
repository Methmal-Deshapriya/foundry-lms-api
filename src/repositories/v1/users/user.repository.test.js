import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findMany: vi.fn() }));

vi.mock("../../../utils/prisma.js", () => ({
  default: { user: { findMany: mocks.findMany } },
}));

import { searchEligibleStudentsForBatch } from "./user.repository.js";

describe("eligible student repository search", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses deterministic keyset ordering and a look-ahead row", async () => {
    mocks.findMany.mockResolvedValue([]);

    await searchEligibleStudentsForBatch("batch-1", "alex", 25, null);

    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ email: "asc" }, { id: "asc" }],
      take: 26,
      select: { id: true, firstName: true, lastName: true, email: true },
      where: expect.objectContaining({
        role: "STUDENT",
        emailVerified: true,
        enrollments: { none: { batchId: "batch-1" } },
        AND: [expect.objectContaining({ OR: expect.any(Array) })],
      }),
    }));
  });

  it("continues after the complete email and id cursor", async () => {
    mocks.findMany.mockResolvedValue([]);

    await searchEligibleStudentsForBatch("batch-1", "", 2, {
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
});
