import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    certificate: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    enrollment: { findUnique: vi.fn() },
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

import { createIssued, revokeIssued } from "./certificate.repository.js";

const certificateId = "90000000-0000-4000-8000-000000000001";
const enrollmentId = "90000000-0000-4000-8000-000000000002";
const intakeId = "90000000-0000-4000-8000-000000000003";

describe("certificate revocation transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    mocks.transaction.enrollment.findUnique.mockResolvedValue({
      intakeId,
    });
  });

  it("locks the enrollment, rechecks the issued credential, and captures lifecycle context", async () => {
    const current = {
      id: certificateId,
      enrollmentId,
      status: "ISSUED",
      enrollment: {
        status: "COMPLETED",
        intake: {
          status: "CLOSED_ACTIVE",
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
    expect(
      mocks.transaction.$queryRawUnsafe.mock.calls.map(([, key]) => key),
    ).toEqual([
      `intake:${intakeId}`,
      `enrollment:${enrollmentId}`,
    ]);
    expect(result.lifecycleContext).toEqual({
      enrollmentStatus: "COMPLETED",
      intakeStatus: "CLOSED_ACTIVE",
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
          intake: { status: "CLOSED_ACTIVE", category: { status: "PUBLISHED" } },
        },
      });

    await expect(
      revokeIssued(certificateId, { status: "REVOKED" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.transaction.certificate.update).not.toHaveBeenCalled();
  });
});

describe("certificate issuance transaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
    mocks.transaction.enrollment.findUnique
      .mockResolvedValueOnce({ intakeId })
      .mockResolvedValue({
        status: "COMPLETED",
        paymentStatus: "COMPLETED",
        course: { certificateEnabled: true },
      });
    mocks.transaction.certificate.findFirst.mockResolvedValue(null);
    mocks.transaction.certificate.create.mockResolvedValue({
      id: certificateId,
      enrollmentId,
      status: "ISSUED",
    });
  });

  it("allows issuance when only revoked history exists", async () => {
    const result = await createIssued({
      enrollmentId,
      certificateCode: "FND-20260814-REPLACEMENT",
    });

    expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(
      expect.any(String),
      `enrollment:${enrollmentId}`,
    );
    expect(result.status).toBe("ISSUED");
    expect(mocks.transaction.certificate.create).toHaveBeenCalledTimes(1);
  });

  it("rejects issuance when another current certificate exists", async () => {
    mocks.transaction.certificate.findFirst.mockResolvedValue({ id: certificateId });

    await expect(
      createIssued({ enrollmentId, certificateCode: "FND-20260814-DUPLICATE" }),
    ).rejects.toMatchObject({ code: "CERTIFICATE_ALREADY_ISSUED" });
    expect(mocks.transaction.certificate.create).not.toHaveBeenCalled();
  });

  it("allows issuance for a free enrollment (payment NOT_REQUIRED, not COMPLETED)", async () => {
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId })
      .mockResolvedValue({
        status: "COMPLETED",
        paymentStatus: "NOT_REQUIRED",
        course: { certificateEnabled: true },
      });

    const result = await createIssued({
      enrollmentId,
      certificateCode: "FND-20260814-FREE",
    });

    expect(result.status).toBe("ISSUED");
    expect(mocks.transaction.certificate.create).toHaveBeenCalledTimes(1);
  });

  it("rejects issuance for a partially paid enrollment, even once the intake itself is complete", async () => {
    mocks.transaction.enrollment.findUnique
      .mockReset()
      .mockResolvedValueOnce({ intakeId })
      .mockResolvedValue({
        status: "COMPLETED",
        paymentStatus: "PARTIAL",
        course: { certificateEnabled: true },
      });

    await expect(
      createIssued({ enrollmentId, certificateCode: "FND-20260814-PARTIAL" }),
    ).rejects.toMatchObject({ code: "CERTIFICATE_ISSUANCE_BLOCKED" });
    expect(mocks.transaction.certificate.create).not.toHaveBeenCalled();
  });
});
