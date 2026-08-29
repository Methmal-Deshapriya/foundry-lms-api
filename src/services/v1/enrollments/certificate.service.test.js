import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError } from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/enrollments/certificate.repository.js", () => ({
  createIssued: vi.fn(),
  findAllAdmin: vi.fn(),
  findByCode: vi.fn(),
  findCurrentByEnrollmentId: vi.fn(),
  findById: vi.fn(),
  findUserCertificates: vi.fn(),
  revokeIssued: vi.fn(),
}));

vi.mock("../../../repositories/v1/enrollments/enrollment.repository.js", () => ({
  findById: vi.fn(),
}));

vi.mock("../../../utils/certificateUtils.js", () => ({
  generateCertificateCode: vi.fn(),
}));

vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as certificateRepo from "../../../repositories/v1/enrollments/certificate.repository.js";
import * as enrollmentRepo from "../../../repositories/v1/enrollments/enrollment.repository.js";
import { generateCertificateCode } from "../../../utils/certificateUtils.js";
import { recordActionService } from "../audit/audit.service.js";
import {
  issueCertificateService,
  revokeCertificateService,
} from "./certificate.service.js";

const enrollmentId = "90000000-0000-4000-8000-000000000001";
const actorId = "90000000-0000-4000-8000-000000000002";
process.env.CLIENT_URL ||= "http://localhost:3000";

function enrollmentFixture() {
  return {
    id: enrollmentId,
    status: "COMPLETED",
    user: {
      firstName: "Test",
      lastName: "Student",
      email: "student@example.com",
    },
    course: {
      title: "Machine Learning",
      slug: "machine-learning",
      skills: ["Python"],
      courseGroup: { certificateEnabled: true },
    },
  };
}

function certificateFixture(code) {
  return {
    id: "90000000-0000-4000-8000-000000000003",
    enrollmentId,
    certificateCode: code,
    status: "ISSUED",
    certificateData: { skills: ["Python"] },
  };
}

describe("certificate service reliability", () => {
  beforeEach(() => vi.clearAllMocks());

  it("retries a random certificate-code collision and preserves the winning code in the snapshot", async () => {
    enrollmentRepo.findById.mockResolvedValue(enrollmentFixture());
    certificateRepo.findCurrentByEnrollmentId.mockResolvedValue(null);
    generateCertificateCode
      .mockReturnValueOnce("FND-20260813-COLLIDE")
      .mockReturnValueOnce("FND-20260813-UNIQUE");
    certificateRepo.createIssued
      .mockRejectedValueOnce(new ConflictError("Unique constraint"))
      .mockResolvedValueOnce(certificateFixture("FND-20260813-UNIQUE"));
    certificateRepo.findByCode.mockResolvedValueOnce(
      certificateFixture("FND-20260813-COLLIDE"),
    );

    const result = await issueCertificateService(
      enrollmentId,
      { description: "Completed" },
      actorId,
    );

    expect(certificateRepo.createIssued).toHaveBeenCalledTimes(2);
    expect(certificateRepo.createIssued).toHaveBeenLastCalledWith(
      expect.objectContaining({
        certificateCode: "FND-20260813-UNIQUE",
        snapshotUrl: expect.stringContaining("FND-20260813-UNIQUE"),
      }),
    );
    expect(result.certificateCode).toBe("FND-20260813-UNIQUE");
  });

  it("does not retry an enrollment uniqueness conflict disguised as a generic conflict", async () => {
    enrollmentRepo.findById.mockResolvedValue(enrollmentFixture());
    certificateRepo.findCurrentByEnrollmentId.mockResolvedValue(null);
    generateCertificateCode.mockReturnValue("FND-20260813-UNIQUE");
    certificateRepo.createIssued.mockRejectedValue(new ConflictError("Unique constraint"));
    certificateRepo.findByCode.mockResolvedValue(null);

    await expect(
      issueCertificateService(enrollmentId, {}, actorId),
    ).rejects.toThrow("Unique constraint");
    expect(certificateRepo.createIssued).toHaveBeenCalledTimes(1);
  });

  it("stops after the bounded number of genuine code collisions", async () => {
    enrollmentRepo.findById.mockResolvedValue(enrollmentFixture());
    certificateRepo.findCurrentByEnrollmentId.mockResolvedValue(null);
    generateCertificateCode.mockReturnValue("FND-20260813-COLLIDE");
    certificateRepo.createIssued.mockRejectedValue(new ConflictError("Unique constraint"));
    certificateRepo.findByCode.mockResolvedValue(
      certificateFixture("FND-20260813-COLLIDE"),
    );

    await expect(
      issueCertificateService(enrollmentId, {}, actorId),
    ).rejects.toMatchObject({
      code: "CERTIFICATE_CODE_GENERATION_FAILED",
      statusCode: 409,
    });
    expect(certificateRepo.createIssued).toHaveBeenCalledTimes(5);
    expect(certificateRepo.findByCode).toHaveBeenCalledTimes(5);
  });

  it("allows a replacement after the previous credential was revoked", async () => {
    enrollmentRepo.findById.mockResolvedValue(enrollmentFixture());
    certificateRepo.findCurrentByEnrollmentId.mockResolvedValue(null);
    generateCertificateCode.mockReturnValue("FND-20260814-REPLACE");
    certificateRepo.createIssued.mockResolvedValue(
      certificateFixture("FND-20260814-REPLACE"),
    );

    const result = await issueCertificateService(enrollmentId, {}, actorId);

    expect(result.certificateCode).toBe("FND-20260814-REPLACE");
    expect(certificateRepo.createIssued).toHaveBeenCalledTimes(1);
  });

  it("revokes against one transactionally captured lifecycle context", async () => {
    const updated = {
      ...certificateFixture("FND-20260813-VALID"),
      status: "REVOKED",
    };
    certificateRepo.revokeIssued.mockResolvedValue({
      certificate: updated,
      lifecycleContext: {
        enrollmentStatus: "COMPLETED",
        courseStatus: "ARCHIVED",
        categoryStatus: "ARCHIVED",
      },
    });

    const result = await revokeCertificateService(
      updated.id,
      { revocationReason: "Issued in error" },
      actorId,
    );

    expect(result.status).toBe("REVOKED");
    expect(certificateRepo.revokeIssued).toHaveBeenCalledWith(
      updated.id,
      expect.objectContaining({
        status: "REVOKED",
        revocationReason: "Issued in error",
      }),
    );
    expect(recordActionService).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          enrollmentStatus: "COMPLETED",
          courseStatus: "ARCHIVED",
        }),
      }),
    );
  });
});
