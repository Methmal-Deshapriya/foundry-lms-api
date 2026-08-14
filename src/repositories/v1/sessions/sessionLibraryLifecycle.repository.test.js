import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    session: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
    },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { restoreSafely, updateSafely } from "./sessionLibrary.repository.js";

const sessionId = "90000000-0000-4000-8000-000000000010";
const courseId = "90000000-0000-4000-8000-000000000011";

function sessionFixture(overrides = {}) {
  return {
    id: sessionId,
    title: "Session 1",
    status: "ARCHIVED",
    recordingUrl: "https://example.com/recording",
    reusePolicy: "REUSABLE",
    courseSessions: [],
    ...overrides,
  };
}

describe("session library lifecycle transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  it("restores an attached or historical session directly to Ready", async () => {
    const usage = [{ courseId, retiredAt: new Date(), _count: { batchLinks: 1 } }];
    mocks.transaction.session.findUnique
      .mockResolvedValueOnce({ courseSessions: [{ courseId }] })
      .mockResolvedValueOnce(sessionFixture({ courseSessions: usage }));
    mocks.transaction.session.update.mockResolvedValue(
      sessionFixture({ status: "READY", courseSessions: usage }),
    );

    const result = await restoreSafely(sessionId);

    expect(result.restoredStatus).toBe("READY");
    expect(mocks.transaction.session.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "READY" } }),
    );
  });

  it("restores a never-used library item to Draft", async () => {
    mocks.transaction.session.findUnique
      .mockResolvedValueOnce({ courseSessions: [] })
      .mockResolvedValueOnce(sessionFixture());
    mocks.transaction.session.update.mockResolvedValue(
      sessionFixture({ status: "DRAFT" }),
    );

    const result = await restoreSafely(sessionId);

    expect(result.restoredStatus).toBe("DRAFT");
  });

  it("rechecks current usage after locking before allowing a Draft transition", async () => {
    mocks.transaction.session.findUnique
      .mockResolvedValueOnce({ courseSessions: [] })
      .mockResolvedValueOnce(
        sessionFixture({
          status: "READY",
          courseSessions: [{ courseId, retiredAt: null, _count: { batchLinks: 0 } }],
        }),
      );

    await expect(updateSafely(sessionId, { status: "DRAFT" })).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mocks.transaction.session.update).not.toHaveBeenCalled();
  });
});
