import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const transaction = {
    $queryRawUnsafe: vi.fn(),
    course: { findUnique: vi.fn() },
    enrollment: { findFirst: vi.fn(async () => null) },
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
// A published course under a paid, admin-enrolled service: the only kind a
// student may request a seat in.
const paidService = { status: "ACTIVE", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED" };
const paidCourse = { id: courseId, status: "PUBLISHED", archivedAt: null, service: paidService };

describe("enrollmentRequest repository invariants", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.transaction.$queryRawUnsafe.mockResolvedValue([{ acquired: 1 }]);
  });

  describe("create", () => {
    it("rejects when the course has no currently open intake", async () => {
      mocks.transaction.course.findUnique.mockResolvedValue({ ...paidCourse, intakes: [] });

      await expect(create(courseId, studentId, "0771234567")).rejects.toMatchObject({
        code: "COURSE_NOT_ENROLLING",
        statusCode: 409,
      });
      expect(mocks.transaction.enrollmentRequest.create).not.toHaveBeenCalled();
    });

    it("answers 404 for an unpublished course, without creating anything", async () => {
      mocks.transaction.course.findUnique.mockResolvedValue({ ...paidCourse, status: "DRAFT", intakes: [{ id: intakeId }] });
      await expect(create(courseId, studentId, "0771234567")).rejects.toMatchObject({ statusCode: 404 });
      expect(mocks.transaction.enrollmentRequest.create).not.toHaveBeenCalled();
    });

    it("answers 404 for an archived course", async () => {
      mocks.transaction.course.findUnique.mockResolvedValue({ ...paidCourse, archivedAt: new Date(), intakes: [{ id: intakeId }] });
      await expect(create(courseId, studentId, "0771234567")).rejects.toMatchObject({ statusCode: 404 });
    });

    it("refuses a request for a free (self-enrolled) course", async () => {
      const freeService = { status: "ACTIVE", accessType: "FREE", courseMode: "EVERGREEN", enrollmentMode: "SELF", paymentRequirement: "NOT_REQUIRED" };
      mocks.transaction.course.findUnique.mockResolvedValue({ ...paidCourse, service: freeService, intakes: [{ id: intakeId }] });
      await expect(create(courseId, studentId, "0771234567")).rejects.toMatchObject({ code: "COURSE_NOT_ENROLLING" });
      expect(mocks.transaction.enrollmentRequest.create).not.toHaveBeenCalled();
    });

    it("refuses a request from a student already enrolled in the open intake (M05-04)", async () => {
      mocks.transaction.course.findUnique.mockResolvedValue({ ...paidCourse, intakes: [{ id: intakeId }] });
      mocks.transaction.enrollmentRequest.findFirst.mockResolvedValue(null);
      mocks.transaction.enrollment.findFirst.mockResolvedValueOnce({ id: "enrollment-1" });
      await expect(create(courseId, studentId, "0771234567")).rejects.toMatchObject({ code: "ALREADY_ENROLLED" });
      expect(mocks.transaction.enrollmentRequest.create).not.toHaveBeenCalled();
    });

    it("rejects a second open request from the same student for the same course", async () => {
      mocks.transaction.course.findUnique.mockResolvedValue({ ...paidCourse, intakes: [{ id: intakeId }] });
      mocks.transaction.enrollmentRequest.findFirst.mockResolvedValue({ id: "existing-request" });

      await expect(create(courseId, studentId, "0771234567")).rejects.toMatchObject({
        code: "ENROLLMENT_REQUEST_ALREADY_OPEN",
        statusCode: 409,
      });
      expect(mocks.transaction.enrollmentRequest.create).not.toHaveBeenCalled();
    });

    it("serializes concurrent submissions with an advisory lock keyed on course+student, then creates against the open intake", async () => {
      mocks.transaction.course.findUnique.mockResolvedValue({ ...paidCourse, intakes: [{ id: intakeId }] });
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
