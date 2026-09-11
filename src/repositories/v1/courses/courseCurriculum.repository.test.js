import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    intake: { findUnique: vi.fn() },
    courseSession: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    findMany: vi.fn(),
    transaction,
    prisma: {
      courseSession: { findMany: vi.fn() },
      $transaction: vi.fn(async (operation) => operation(transaction)),
    },
  };
});
vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { findCurriculum, reorder, updateDelivery } from "./courseCurriculum.repository.js";

const intakeId = "30000000-0000-4000-8000-000000000001";
const courseSessionId = "30000000-0000-4000-8000-000000000002";

function prepareDelivery(rows, intakeOverrides = {}) {
  mocks.transaction.intake.findUnique
    .mockResolvedValueOnce({
      categoryId: "30000000-0000-4000-8000-000000000003",
      courseId: "30000000-0000-4000-8000-000000000004",
      category: { serviceId: "service-1" },
    })
    .mockResolvedValueOnce({
      id: intakeId,
      status: "OPEN_ACTIVE",
      course: { archivedAt: null },
      category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL" } },
      ...intakeOverrides,
    });
  mocks.transaction.courseSession.findFirst.mockResolvedValue({
    id: courseSessionId,
    intakeId,
    orderIndex: 1,
    firstReleasedAt: null,
    session: { status: "READY" },
  });
  mocks.transaction.courseSession.findMany.mockResolvedValue(rows);
  mocks.transaction.courseSession.update.mockResolvedValue({
    id: courseSessionId,
    intakeId,
    orderIndex: 1,
    deliveryStatus: "SCHEDULED",
    session: { status: "READY" },
    _count: { completions: 0 },
  });
}

describe("course curriculum repository reads", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hides retired relationships from the live curriculum", async () => {
    mocks.prisma.courseSession.findMany.mockResolvedValue([]);
    await findCurriculum("intake-1");
    expect(mocks.prisma.courseSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { intakeId: "intake-1", retiredAt: null } }));
  });

  it("returns active and historical relationships for administration", async () => {
    mocks.prisma.courseSession.findMany.mockResolvedValue([]);
    await findCurriculum("intake-1", true);
    expect(mocks.prisma.courseSession.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { intakeId: "intake-1" } }));
  });

  it("warns before releasing a later session while an earlier schedule is not yet available", async () => {
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    prepareDelivery([
      { id: "first", orderIndex: 0, deliveryStatus: "SCHEDULED", availableAt: new Date(Date.now() + 86_400_000), session: { title: "First" } },
      { id: courseSessionId, orderIndex: 1, deliveryStatus: "UNRELEASED", availableAt: null, session: { title: "Second" } },
    ]);

    await expect(updateDelivery(intakeId, courseSessionId, {
      status: "RELEASED",
      availableAt: null,
      acknowledgeSequenceRisk: false,
    })).rejects.toMatchObject({ code: "SEQUENCE_RISK_CONFIRMATION_REQUIRED" });
  });

  it("allows a later scheduled session only after the earlier scheduled boundary", async () => {
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    const firstAvailability = new Date(Date.now() + 86_400_000);
    const secondAvailability = new Date(Date.now() + 172_800_000);
    prepareDelivery([
      { id: "first", orderIndex: 0, deliveryStatus: "SCHEDULED", availableAt: firstAvailability, session: { title: "First" } },
      { id: courseSessionId, orderIndex: 1, deliveryStatus: "UNRELEASED", availableAt: null, session: { title: "Second" } },
    ]);

    await expect(updateDelivery(intakeId, courseSessionId, {
      status: "SCHEDULED",
      availableAt: secondAvailability,
      acknowledgeSequenceRisk: false,
    })).resolves.toMatchObject({ id: courseSessionId });
  });

  it("does not withdraw the final visible session from an open free intake", async () => {
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    prepareDelivery([
      { id: courseSessionId, orderIndex: 0, deliveryStatus: "RELEASED", availableAt: null, session: { title: "Only lesson" } },
    ], { category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "FREE", courseMode: "EVERGREEN" } } });
    mocks.transaction.courseSession.findFirst.mockResolvedValue({
      id: courseSessionId,
      intakeId,
      orderIndex: 0,
      deliveryStatus: "RELEASED",
      availableAt: null,
      firstReleasedAt: new Date(),
      session: { status: "READY" },
    });
    mocks.transaction.courseSession.count.mockResolvedValue(0);

    await expect(updateDelivery(intakeId, courseSessionId, {
      status: "WITHDRAWN",
      availableAt: null,
      acknowledgeSequenceRisk: false,
    })).rejects.toMatchObject({ code: "FREE_INTAKE_REQUIRES_VISIBLE_SESSION" });
  });

  it("requires an explicit acknowledgement before moving exposed curriculum", async () => {
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    mocks.transaction.intake.findUnique
      .mockResolvedValueOnce({
        categoryId: "30000000-0000-4000-8000-000000000003",
        courseId: "30000000-0000-4000-8000-000000000004",
        category: { serviceId: "service-1" },
      })
      .mockResolvedValueOnce({
        id: intakeId,
        status: "CLOSED_ACTIVE",
        course: { archivedAt: null },
        category: { status: "PUBLISHED", service: { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL" } },
      });
    mocks.transaction.courseSession.findMany.mockResolvedValue([
      { id: "first", orderIndex: 0, deliveryStatus: "RELEASED", firstReleasedAt: new Date(), _count: { completions: 2 }, session: { title: "First" } },
      { id: "second", orderIndex: 1, deliveryStatus: "UNRELEASED", firstReleasedAt: null, _count: { completions: 0 }, session: { title: "Second" } },
    ]);

    await expect(reorder(intakeId, [
      { id: "second", orderIndex: 0 },
      { id: "first", orderIndex: 1 },
    ], false)).rejects.toMatchObject({ code: "SEQUENCE_RISK_CONFIRMATION_REQUIRED" });
    expect(mocks.transaction.courseSession.updateMany).not.toHaveBeenCalled();
  });
});
