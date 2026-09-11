import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, CourseCapacityReachedError } from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/enrollments/enrollment.repository.js", () => ({
  createPaid: vi.fn(), enrollFree: vi.fn(), findById: vi.fn(), update: vi.fn(), completePayment: vi.fn(),
  findUserEnrollments: vi.fn(), findCourseEnrollments: vi.fn(), searchEligibleStudents: vi.fn(),
}));
vi.mock("../../../repositories/v1/users/user.repository.js", () => ({ findUserById: vi.fn(), findVerifiedStudentsByIds: vi.fn() }));
vi.mock("../../../repositories/v1/catalog/intake.repository.js", () => ({ findById: vi.fn(), findPublishedFreeIntakeById: vi.fn() }));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as enrollmentRepository from "../../../repositories/v1/enrollments/enrollment.repository.js";
import * as userRepository from "../../../repositories/v1/users/user.repository.js";
import * as intakeRepository from "../../../repositories/v1/catalog/intake.repository.js";
import { recordActionService } from "../audit/audit.service.js";
import { bulkEnrollStudentsInCourseService, completePaymentService, enrollStudentInCourseService, getEligibleStudentsForCourseService, selfEnrollFreeCourseService, updateEnrollmentService } from "./enrollment.service.js";

const actorId = "90000000-0000-4000-8000-000000000001";
const userId = "90000000-0000-4000-8000-000000000002";
const secondUserId = "90000000-0000-4000-8000-000000000003";
const courseId = "90000000-0000-4000-8000-000000000004";
const intakeId = "90000000-0000-4000-8000-000000000005";

function intakeFixture(serviceType = "BOOTCAMPS", overrides = {}) {
  const free = serviceType === "FREE_LEARNING";
  const category = { status: "PUBLISHED", service: { key: serviceType, status: "ACTIVE", accessType: free ? "FREE" : "PAID", courseMode: free ? "EVERGREEN" : "SEASONAL", enrollmentMode: free ? "SELF" : "ADMIN", paymentRequirement: free ? "NOT_REQUIRED" : "REQUIRED" } };
  return {
    id: intakeId,
    courseId,
    code: free ? "GIT-EVERGREEN" : "AI-ML-2026-B1",
    intakeKey: free ? "EVERGREEN" : "2026-B1",
    capacity: null,
    status: "OPEN_ACTIVE",
    category,
    course: { id: courseId, title: "AI/ML Ignition", slug: "ai-ml-ignition", summary: "Practical foundations", level: "BEGINNER", durationValue: 4, durationUnit: "MONTH", price: free ? 0 : 1000, currency: "LKR", certificateEnabled: false, category },
    ...overrides,
  };
}

function studentFixture(id = userId) { return { id, email: `${id}@example.com`, firstName: "Test", lastName: "Student", role: "STUDENT", emailVerified: true }; }

function enrollmentFixture(overrides = {}) {
  const source = overrides.source ?? "ADMIN";
  const intake = intakeFixture(source === "SELF" ? "FREE_LEARNING" : "BOOTCAMPS");
  return { id: "90000000-0000-4000-8000-000000000006", userId, courseId, intakeId, source, status: "ACTIVE", paymentStatus: source === "SELF" ? "NOT_REQUIRED" : "COMPLETED", paymentCompletedAt: source === "SELF" ? null : new Date(), externalPaymentReference: null, paymentNote: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), user: studentFixture(), enrolledBy: null, certificates: [], course: intake.course, intake, ...overrides };
}

describe("course enrollment service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("manually enrolls a verified student in an open paid intake", async () => {
    intakeRepository.findById.mockResolvedValue(intakeFixture());
    userRepository.findUserById.mockResolvedValue(studentFixture());
    enrollmentRepository.createPaid.mockResolvedValue(enrollmentFixture());
    const result = await enrollStudentInCourseService(intakeId, { userId }, actorId);
    expect(enrollmentRepository.createPaid).toHaveBeenCalledWith(intakeId, userId, actorId, expect.objectContaining({ paymentStatus: "COMPLETED", paymentCompletedAt: expect.any(Date) }));
    expect(result.courseId).toBe(courseId);
  });

  it("rejects manual enrollment when a paid intake is closed", async () => {
    intakeRepository.findById.mockResolvedValue(intakeFixture("BOOTCAMPS", { status: "CLOSED_ACTIVE" }));
    userRepository.findUserById.mockResolvedValue(studentFixture());
    await expect(enrollStudentInCourseService(intakeId, { userId }, actorId)).rejects.toMatchObject({ code: "COURSE_ENROLLMENT_CLOSED" });
  });

  it("returns per-student bulk failures without hiding duplicates", async () => {
    intakeRepository.findById.mockResolvedValue(intakeFixture());
    userRepository.findVerifiedStudentsByIds.mockResolvedValue([studentFixture(), studentFixture(secondUserId)]);
    enrollmentRepository.createPaid.mockResolvedValueOnce(enrollmentFixture()).mockRejectedValueOnce(new ConflictError("Already enrolled."));
    const result = await bulkEnrollStudentsInCourseService(intakeId, { students: [{ userId }, { userId: secondUserId }] }, actorId);
    expect(result.summary).toEqual({ requested: 2, created: 1, failed: 1 });
  });

  it("stops opening transactions once intake capacity is exhausted", async () => {
    intakeRepository.findById.mockResolvedValue(intakeFixture());
    userRepository.findVerifiedStudentsByIds.mockResolvedValue([studentFixture(), studentFixture(secondUserId)]);
    enrollmentRepository.createPaid.mockRejectedValueOnce(new CourseCapacityReachedError());
    const result = await bulkEnrollStudentsInCourseService(intakeId, { students: [{ userId }, { userId: secondUserId }] }, actorId);
    expect(enrollmentRepository.createPaid).toHaveBeenCalledTimes(1);
    expect(result.results.every(({ code }) => code === "COURSE_CAPACITY_REACHED")).toBe(true);
  });

  it("keeps free self-enrollment idempotent", async () => {
    const intake = intakeFixture("FREE_LEARNING");
    intakeRepository.findPublishedFreeIntakeById.mockResolvedValue(intake);
    userRepository.findUserById.mockResolvedValue(studentFixture());
    enrollmentRepository.enrollFree.mockResolvedValue({ enrollment: enrollmentFixture({ source: "SELF" }), outcome: "EXISTING" });
    const result = await selfEnrollFreeCourseService(intakeId, { id: userId, role: "STUDENT" });
    expect(result).toMatchObject({ created: false, reactivated: false });
    expect(recordActionService).not.toHaveBeenCalled();
  });

  it("reactivates the same cancelled free enrollment", async () => {
    const intake = intakeFixture("FREE_LEARNING");
    intakeRepository.findPublishedFreeIntakeById.mockResolvedValue(intake);
    userRepository.findUserById.mockResolvedValue(studentFixture());
    enrollmentRepository.enrollFree.mockResolvedValue({ enrollment: enrollmentFixture({ source: "SELF" }), outcome: "REACTIVATED" });
    const result = await selfEnrollFreeCourseService(intakeId, { id: userId, role: "STUDENT" });
    expect(result.reactivated).toBe(true);
  });

  it("keeps completed enrollment status terminal", async () => {
    enrollmentRepository.findById.mockResolvedValue(enrollmentFixture({ status: "COMPLETED", completedAt: new Date() }));
    // A same-value "update" is the only way to reach the terminal check here —
    // any actual transition away from COMPLETED is already rejected earlier by
    // ENROLLMENT_STATUS_TRANSITIONS, which allows no transitions out of it at all.
    await expect(updateEnrollmentService("90000000-0000-4000-8000-000000000006", { status: "COMPLETED" }, actorId)).rejects.toThrow(/terminal/i);
  });

  it("no longer accepts paymentStatus on the generic update endpoint — it silently drops the field", async () => {
    enrollmentRepository.findById.mockResolvedValue(enrollmentFixture({ status: "ACTIVE" }));
    await expect(updateEnrollmentService("90000000-0000-4000-8000-000000000006", { paymentStatus: "PARTIAL" }, actorId)).rejects.toThrow(/at least one field/i);
  });

  it("returns cursor pagination for eligible students scoped to an intake", async () => {
    intakeRepository.findById.mockResolvedValue(intakeFixture());
    const students = [studentFixture(), studentFixture(secondUserId), studentFixture("90000000-0000-4000-8000-000000000008")];
    enrollmentRepository.searchEligibleStudents.mockResolvedValue(students);
    const result = await getEligibleStudentsForCourseService(intakeId, { q: "test", limit: "2" });
    expect(result.pagination).toMatchObject({ limit: 2, hasMore: true, nextCursor: expect.any(String) });
    expect(enrollmentRepository.searchEligibleStudents).toHaveBeenCalledWith(intakeId, "test", 2, null);
  });

  it("completes the remaining payment for a PARTIAL enrollment", async () => {
    enrollmentRepository.findById.mockResolvedValue(enrollmentFixture({ paymentStatus: "PARTIAL" }));
    enrollmentRepository.completePayment.mockResolvedValue(enrollmentFixture({ paymentStatus: "COMPLETED" }));
    const result = await completePaymentService("90000000-0000-4000-8000-000000000006", actorId);
    expect(enrollmentRepository.completePayment).toHaveBeenCalledWith("90000000-0000-4000-8000-000000000006", actorId);
    expect(result.paymentStatus).toBe("COMPLETED");
    expect(recordActionService).toHaveBeenCalledWith(expect.objectContaining({ actorUserId: actorId, entityId: "90000000-0000-4000-8000-000000000006" }));
  });

  it("refuses to complete payment for an enrollment that isn't PARTIAL", async () => {
    enrollmentRepository.findById.mockResolvedValue(enrollmentFixture({ paymentStatus: "COMPLETED" }));
    await expect(completePaymentService("90000000-0000-4000-8000-000000000006", actorId)).rejects.toMatchObject({ code: "PAYMENT_NOT_PARTIAL" });
    expect(enrollmentRepository.completePayment).not.toHaveBeenCalled();
  });
});
