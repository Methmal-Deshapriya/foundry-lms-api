import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    certificate: { findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (callback) => callback(transaction)),
      certificate: {},
    },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { revokeIssued } from "./certificate.repository.js";

const certificateId = "90000000-0000-4000-8000-000000000001";
const enrollmentId = "90000000-0000-4000-8000-000000000002";

describe("certificate revocation transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  it("locks the enrollment, rechecks the issued credential, and captures lifecycle context", async () => {
    const current = {
      id: certificateId,
      enrollmentId,
      status: "ISSUED",
      enrollment: {
        status: "COMPLETED",
        batchId: "batch-1",
        batch: { status: "ACTIVE" },
        course: {
          status: "PUBLISHED",
          category: { status: "PUBLISHED" },
        },
      },
    };
    mocks.transaction.certificate.findUnique
      .mockResolvedValueOnce({ enrollmentId })
      .mockResolvedValueOnce(current);
    mocks.transaction.certificate.update.mockResolvedValue({
      ...current,
      status: "REVOKED",
    });

    const result = await revokeIssued(certificateId, {
      status: "REVOKED",
      revocationReason: "Issued in error",
    });

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      `enrollment:${enrollmentId}`,
    );
    expect(result.lifecycleContext).toEqual({
      enrollmentStatus: "COMPLETED",
      batchId: "batch-1",
      batchStatus: "ACTIVE",
      courseStatus: "PUBLISHED",
      categoryStatus: "PUBLISHED",
    });
    expect(mocks.transaction.certificate.update).toHaveBeenCalledTimes(1);
  });

  it("rejects a concurrent repeat after the locked reread", async () => {
    mocks.transaction.certificate.findUnique
      .mockResolvedValueOnce({ enrollmentId })
      .mockResolvedValueOnce({
        status: "REVOKED",
        enrollment: {
          status: "COMPLETED",
          batchId: null,
          batch: null,
          course: { status: "PUBLISHED", category: { status: "PUBLISHED" } },
        },
      });

    await expect(
      revokeIssued(certificateId, { status: "REVOKED" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.transaction.certificate.update).not.toHaveBeenCalled();
  });
});
