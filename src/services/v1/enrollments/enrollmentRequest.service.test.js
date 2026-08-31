import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/enrollments/enrollmentRequest.repository.js", () => ({
  create: vi.fn(),
  findById: vi.fn(),
  findForIntake: vi.fn(),
  updateStatus: vi.fn(),
  markEnrolled: vi.fn(),
  retarget: vi.fn(),
}));
vi.mock("../../../repositories/v1/catalog/intake.repository.js", () => ({ findById: vi.fn() }));
vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({ findCurrentOpenIntakeId: vi.fn() }));
vi.mock("../../../repositories/v1/users/user.repository.js", () => ({ findAdminEmails: vi.fn() }));
vi.mock("./enrollment.service.js", () => ({ enrollStudentInCourseService: vi.fn() }));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("../../../utils/email.js", () => ({ sendEnrollmentRequestNotificationEmail: vi.fn() }));
vi.mock("../../../utils/prisma.js", () => ({
  default: { $transaction: vi.fn((callback) => callback({})) },
}));

import * as repository from "../../../repositories/v1/enrollments/enrollmentRequest.repository.js";
import * as intakeRepository from "../../../repositories/v1/catalog/intake.repository.js";
import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import * as userRepository from "../../../repositories/v1/users/user.repository.js";
import { enrollStudentInCourseService } from "./enrollment.service.js";
import { sendEnrollmentRequestNotificationEmail } from "../../../utils/email.js";
import {
  createEnrollmentRequestService,
  enrollFromRequestService,
  getEnrollmentRequestAdminService,
  listEnrollmentRequestsForIntakeService,
  updateEnrollmentRequestStatusService,
} from "./enrollmentRequest.service.js";

const actorId = "90000000-0000-4000-8000-000000000001";
const studentId = "90000000-0000-4000-8000-000000000002";
const courseId = "90000000-0000-4000-8000-000000000003";
const intakeId = "90000000-0000-4000-8000-000000000004";
const otherIntakeId = "90000000-0000-4000-8000-000000000005";
const categoryId = "90000000-0000-4000-8000-000000000006";
const requestId = "90000000-0000-4000-8000-000000000007";
const enrollmentId = "90000000-0000-4000-8000-000000000008";

const student = { id: studentId, email: "student@example.com", firstName: "Ada", lastName: "Lovelace" };

function requestFixture(overrides = {}) {
  return {
    id: requestId,
    courseId,
    intakeId,
    studentUserId: studentId,
    status: "PENDING",
    contactPhone: "0771234567",
    contactedAt: null,
    contactedByUserId: null,
    enrollmentId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    course: {
      id: courseId,
      title: "AI/ML Ignition Program",
      slug: "ai-ml-ignition",
      categoryId,
      category: { slug: "bootcamps", service: { slug: "professional-workshops" } },
    },
    intake: { id: intakeId, code: "AI-ML-2026-1", status: "OPEN_ACTIVE" },
    student,
    contactedBy: null,
    ...overrides,
  };
}

// Waits out the fire-and-forget notification promise chain so its
// `sendEnrollmentRequestNotificationEmail` call (or lack of one) has
// actually settled before assertions run.
async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("enrollmentRequest service", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("createEnrollmentRequestService", () => {
    it("creates the request and emails every admin a working deep link", async () => {
      const request = requestFixture();
      repository.create.mockResolvedValue(request);
      userRepository.findAdminEmails.mockResolvedValue(["admin@example.com"]);

      const result = await createEnrollmentRequestService(courseId, { contactPhone: "0771234567" }, student);
      expect(result.id).toBe(requestId);
      expect(repository.create).toHaveBeenCalledWith(courseId, studentId, "0771234567");

      await flush();
      expect(sendEnrollmentRequestNotificationEmail).toHaveBeenCalledWith(
        "admin@example.com",
        expect.objectContaining({
          requestUrl: `${process.env.CLIENT_URL?.replace(/\/$/, "") ?? ""}/admin/services/professional-workshops/categories/${categoryId}/courses/${courseId}/intakes/${intakeId}?tab=enrollment-requests&requestId=${requestId}`,
        }),
      );
    });

    it("does not fail the request when notifying admins throws", async () => {
      repository.create.mockResolvedValue(requestFixture());
      userRepository.findAdminEmails.mockRejectedValue(new Error("SMTP down"));

      await expect(createEnrollmentRequestService(courseId, { contactPhone: "0771234567" }, student)).resolves.toMatchObject({ id: requestId });
      await flush();
    });

    it("skips emailing when there are no admins", async () => {
      repository.create.mockResolvedValue(requestFixture());
      userRepository.findAdminEmails.mockResolvedValue([]);

      await createEnrollmentRequestService(courseId, { contactPhone: "0771234567" }, student);
      await flush();
      expect(sendEnrollmentRequestNotificationEmail).not.toHaveBeenCalled();
    });
  });

  describe("listEnrollmentRequestsForIntakeService", () => {
    it("404s when the intake doesn't exist", async () => {
      intakeRepository.findById.mockResolvedValue(null);
      await expect(listEnrollmentRequestsForIntakeService(intakeId, {})).rejects.toMatchObject({ statusCode: 404 });
    });

    it("returns a status summary alongside the page", async () => {
      intakeRepository.findById.mockResolvedValue({ id: intakeId });
      repository.findForIntake.mockResolvedValue({
        total: 1,
        statusCounts: [{ status: "PENDING", _count: 1 }],
        requests: [requestFixture()],
      });
      const result = await listEnrollmentRequestsForIntakeService(intakeId, {});
      expect(result.summary).toEqual({ all: 1, PENDING: 1, CONTACTED: 0, ENROLLED: 0, DECLINED: 0 });
      expect(result.requests).toHaveLength(1);
    });
  });

  describe("getEnrollmentRequestAdminService", () => {
    it("404s when not found", async () => {
      repository.findById.mockResolvedValue(null);
      await expect(getEnrollmentRequestAdminService(requestId)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("updateEnrollmentRequestStatusService — transitions", () => {
    it.each([
      ["PENDING", "CONTACTED"],
      ["PENDING", "DECLINED"],
      ["CONTACTED", "DECLINED"],
      ["DECLINED", "PENDING"], // reopen — Q2 of the 2026-08-30 system guide/audit
    ])("allows %s -> %s", async (from, to) => {
      repository.findById.mockResolvedValue(requestFixture({ status: from }));
      repository.updateStatus.mockResolvedValue(requestFixture({ status: to }));
      const result = await updateEnrollmentRequestStatusService(requestId, { status: to }, actorId);
      expect(result.status).toBe(to);
      expect(repository.updateStatus).toHaveBeenCalledWith(requestId, from, to, actorId);
    });

    it.each([
      ["ENROLLED", "PENDING"],
      ["ENROLLED", "DECLINED"],
      ["CONTACTED", "PENDING"],
      ["DECLINED", "DECLINED"],
    ])("rejects %s -> %s", async (from, to) => {
      repository.findById.mockResolvedValue(requestFixture({ status: from }));
      await expect(updateEnrollmentRequestStatusService(requestId, { status: to }, actorId)).rejects.toMatchObject({ statusCode: 409 });
      expect(repository.updateStatus).not.toHaveBeenCalled();
    });

    it("404s when the request doesn't exist", async () => {
      repository.findById.mockResolvedValue(null);
      await expect(updateEnrollmentRequestStatusService(requestId, { status: "CONTACTED" }, actorId)).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("enrollFromRequestService", () => {
    it("converts a live (still-open) request through the shared enroll mutation", async () => {
      repository.findById.mockResolvedValue(requestFixture());
      enrollStudentInCourseService.mockResolvedValue({ id: enrollmentId });
      repository.markEnrolled.mockResolvedValue(requestFixture({ status: "ENROLLED", enrollmentId }));

      const result = await enrollFromRequestService(requestId, { paymentStatus: "COMPLETED" }, actorId);

      expect(enrollStudentInCourseService).toHaveBeenCalledWith(
        intakeId,
        { userId: studentId, paymentStatus: "COMPLETED" },
        actorId,
      );
      expect(repository.retarget).not.toHaveBeenCalled();
      expect(result.enrollment).toEqual({ id: enrollmentId });
    });

    it("re-resolves to the course's currently open intake when the original has closed", async () => {
      repository.findById.mockResolvedValue(
        requestFixture({ intake: { id: intakeId, code: "AI-ML-2026-1", status: "CLOSED_ACTIVE" } }),
      );
      courseRepository.findCurrentOpenIntakeId.mockResolvedValue(otherIntakeId);
      enrollStudentInCourseService.mockResolvedValue({ id: enrollmentId });
      repository.markEnrolled.mockResolvedValue(requestFixture({ status: "ENROLLED", enrollmentId }));

      await enrollFromRequestService(requestId, { paymentStatus: "COMPLETED" }, actorId);

      expect(repository.retarget).toHaveBeenCalledWith(requestId, otherIntakeId);
      expect(enrollStudentInCourseService).toHaveBeenCalledWith(
        otherIntakeId,
        { userId: studentId, paymentStatus: "COMPLETED" },
        actorId,
      );
    });

    it("fails cleanly when the course has no open intake to retarget to", async () => {
      repository.findById.mockResolvedValue(
        requestFixture({ intake: { id: intakeId, code: "AI-ML-2026-1", status: "CLOSED_ACTIVE" } }),
      );
      courseRepository.findCurrentOpenIntakeId.mockResolvedValue(null);

      await expect(enrollFromRequestService(requestId, { paymentStatus: "COMPLETED" }, actorId)).rejects.toMatchObject({
        statusCode: 409,
        code: "COURSE_NOT_ENROLLING",
      });
      expect(enrollStudentInCourseService).not.toHaveBeenCalled();
    });

    it("rejects converting an already-declined or already-enrolled request", async () => {
      repository.findById.mockResolvedValue(requestFixture({ status: "DECLINED" }));
      await expect(enrollFromRequestService(requestId, {}, actorId)).rejects.toMatchObject({ statusCode: 409 });
      expect(enrollStudentInCourseService).not.toHaveBeenCalled();
    });

    it("404s when the request doesn't exist", async () => {
      repository.findById.mockResolvedValue(null);
      await expect(enrollFromRequestService(requestId, {}, actorId)).rejects.toMatchObject({ statusCode: 404 });
    });
  });
});
