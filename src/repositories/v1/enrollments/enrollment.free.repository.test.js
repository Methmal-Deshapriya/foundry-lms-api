import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    intake: { findUnique: vi.fn(), findFirst: vi.fn() },
    enrollment: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn() },
  };
  return {
    transaction,
    prisma: { $transaction: vi.fn((callback) => callback(transaction)), enrollment: { findUnique: vi.fn(async () => ({ id: "e-1" })), findMany: vi.fn() } },
  };
});
vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { enrollFree, findAtRiskCandidates } from "./enrollment.repository.js";

const intakeId = "i-free";
const openFreeIntake = (capacity) => ({ id: intakeId, courseId: "c-free", capacity });

describe("free self-enrollment seat limit (M05-12)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    mocks.transaction.intake.findUnique.mockResolvedValue({ serviceId: "s-free" });
    mocks.transaction.enrollment.findUnique.mockResolvedValue(null);
    mocks.transaction.enrollment.create.mockResolvedValue({ id: "e-1" });
  });

  it("refuses a new student once a capped free intake is full", async () => {
    mocks.transaction.intake.findFirst.mockResolvedValue(openFreeIntake(50));
    mocks.transaction.enrollment.count.mockResolvedValue(50);
    await expect(enrollFree("student-1", intakeId)).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.transaction.enrollment.create).not.toHaveBeenCalled();
  });

  it("enrolls while seats remain", async () => {
    mocks.transaction.intake.findFirst.mockResolvedValue(openFreeIntake(50));
    mocks.transaction.enrollment.count.mockResolvedValue(49);
    await expect(enrollFree("student-1", intakeId)).resolves.toMatchObject({ outcome: "CREATED" });
  });

  it("stays unlimited when no seat limit is set", async () => {
    mocks.transaction.intake.findFirst.mockResolvedValue(openFreeIntake(null));
    await enrollFree("student-1", intakeId);
    expect(mocks.transaction.enrollment.count).not.toHaveBeenCalled();
    expect(mocks.transaction.enrollment.create).toHaveBeenCalled();
  });

  it("applies the limit when a cancelled learner comes back", async () => {
    mocks.transaction.intake.findFirst.mockResolvedValue(openFreeIntake(10));
    mocks.transaction.enrollment.findUnique.mockResolvedValue({ id: "e-1", status: "CANCELLED", source: "SELF" });
    mocks.transaction.enrollment.count.mockResolvedValue(10);
    await expect(enrollFree("student-1", intakeId)).rejects.toMatchObject({ statusCode: 409 });
    expect(mocks.transaction.enrollment.update).not.toHaveBeenCalled();
  });
});

describe("at-risk candidates (M05-10)", () => {
  it("asks the database for paid intakes with no completion since the cutoff, capped", async () => {
    mocks.prisma.enrollment.findMany.mockResolvedValue([]);
    const since = new Date("2026-09-17T00:00:00.000Z");
    await findAtRiskCandidates(since);
    const { where, take } = mocks.prisma.enrollment.findMany.mock.calls[0][0];
    expect(where.intake.service).toEqual({ accessType: "PAID" });
    expect(where.sessionCompletions).toEqual({ none: { completedAt: { gte: since } } });
    expect(take).toBe(501);
  });
});
