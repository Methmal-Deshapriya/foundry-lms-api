import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    course: { findUnique: vi.fn() },
    enrollmentRequest: { findFirst: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  };
  return {
    transaction,
    prisma: {
      $transaction: vi.fn(async (operation) => operation(transaction)),
      enrollmentRequest: { update: vi.fn() },
    },
  };
});

vi.mock("../../../utils/prisma.js", () => ({ default: mocks.prisma }));

import { create, retarget, updateStatus } from "./enrollmentRequest.repository.js";

const courseId = "30000000-0000-4000-8000-000000000001";
const intakeId = "30000000-0000-4000-8000-000000000002";
const otherIntakeId = "30000000-0000-4000-8000-000000000003";
const studentId = "30000000-0000-4000-8000-000000000004";
const requestId = "30000000-0000-4000-8000-000000000005";
const actorId = "30000000-0000-4000-8000-000000000006";

describe("enrollmentRequest repository invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  describe("create", () => {
    it("rejects when the course has no currently open intake", async () => {
      mocks.transaction.course.findUnique.mockResolvedValue({ id: courseId, intakes: [] });

      await expect(create(courseId, studentId, "0771234567")).rejects.toMatchObject({
        code: "COURSE_NOT_ENROLLING",
        statusCode: 409,
      });
      expect(mocks.transaction.enrollmentRequest.create).not.toHaveBeenCalled();
    });

    it("rejects a second open request from the same student for the same course", async () => {
      mocks.transaction.course.findUnique.mockResolvedValue({ id: courseId, intakes: [{ id: intakeId }] });
      mocks.transaction.enrollmentRequest.findFirst.mockResolvedValue({ id: "existing-request" });

      await expect(create(courseId, studentId, "0771234567")).rejects.toMatchObject({
        code: "ENROLLMENT_REQUEST_ALREADY_OPEN",
        statusCode: 409,
      });
      expect(mocks.transaction.enrollmentRequest.create).not.toHaveBeenCalled();
    });

    it("serializes concurrent submissions with an advisory lock keyed on course+student, then creates against the open intake", async () => {
      mocks.transaction.course.findUnique.mockResolvedValue({ id: courseId, intakes: [{ id: intakeId }] });
      mocks.transaction.enrollmentRequest.findFirst.mockResolvedValue(null);
      mocks.transaction.enrollmentRequest.create.mockResolvedValue({ id: requestId });

      await create(courseId, studentId, "0771234567");

      expect(mocks.transaction.$queryRawUnsafe).toHaveBeenCalledWith(expect.any(String), `enrollment-request:${courseId}:${studentId}`);
      expect(mocks.transaction.enrollmentRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { courseId, intakeId, studentUserId: studentId, contactPhone: "0771234567", status: "PENDING" },
        }),
      );
    });
  });

  describe("updateStatus", () => {
    it("rejects a stale expected-status precondition", async () => {
      mocks.transaction.enrollmentRequest.findUnique.mockResolvedValue({ id: requestId, status: "CONTACTED" });
      await expect(updateStatus(requestId, "PENDING", "CONTACTED", actorId)).rejects.toMatchObject({
        code: "STALE_ENROLLMENT_REQUEST_STATUS",
        statusCode: 409,
      });
    });

    it("stamps contactedAt/contactedByUserId only when moving to CONTACTED", async () => {
      mocks.transaction.enrollmentRequest.findUnique.mockResolvedValue({ id: requestId, status: "PENDING" });
      await updateStatus(requestId, "PENDING", "CONTACTED", actorId);
      expect(mocks.transaction.enrollmentRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "CONTACTED", contactedByUserId: actorId }),
        }),
      );
    });

    it("reopening to PENDING does not touch contactedAt/contactedByUserId", async () => {
      mocks.transaction.enrollmentRequest.findUnique.mockResolvedValue({ id: requestId, status: "DECLINED" });
      await updateStatus(requestId, "DECLINED", "PENDING", actorId);
      const [[call]] = mocks.transaction.enrollmentRequest.update.mock.calls;
      expect(call.data).toEqual({ status: "PENDING" });
    });
  });

  describe("retarget", () => {
    it("re-points a request at a different intake of the same course", async () => {
      mocks.prisma.enrollmentRequest.update.mockResolvedValue({ id: requestId, intakeId: otherIntakeId });
      const result = await retarget(requestId, otherIntakeId);
      expect(mocks.prisma.enrollmentRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: requestId }, data: { intakeId: otherIntakeId } }),
      );
      expect(result.intakeId).toBe(otherIntakeId);
    });
  });
});
