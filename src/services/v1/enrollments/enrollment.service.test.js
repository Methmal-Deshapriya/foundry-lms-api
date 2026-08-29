import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConflictError, CourseCapacityReachedError } from "../../../utils/Errors.js";

vi.mock("../../../repositories/v1/enrollments/enrollment.repository.js", () => ({
  createPaid: vi.fn(), enrollFree: vi.fn(), findById: vi.fn(), update: vi.fn(),
  findUserEnrollments: vi.fn(), findCourseEnrollments: vi.fn(), searchEligibleStudents: vi.fn(),
}));
vi.mock("../../../repositories/v1/users/user.repository.js", () => ({ findUserById: vi.fn(), findVerifiedStudentsByIds: vi.fn() }));
vi.mock("../../../repositories/v1/catalog/course.repository.js", () => ({ findById: vi.fn(), findPublishedFreeById: vi.fn() }));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as enrollmentRepository from "../../../repositories/v1/enrollments/enrollment.repository.js";
import * as userRepository from "../../../repositories/v1/users/user.repository.js";
import * as courseRepository from "../../../repositories/v1/catalog/course.repository.js";
import { recordActionService } from "../audit/audit.service.js";
import { bulkEnrollStudentsInCourseService, enrollStudentInCourseService, getEligibleStudentsForCourseService, selfEnrollFreeCourseService, updateEnrollmentService } from "./enrollment.service.js";

const actorId = "90000000-0000-4000-8000-000000000001";
const userId = "90000000-0000-4000-8000-000000000002";
const secondUserId = "90000000-0000-4000-8000-000000000003";
const courseId = "90000000-0000-4000-8000-000000000004";

function courseFixture(serviceType = "BOOTCAMPS", overrides = {}) {
  const free = serviceType === "FREE_LEARNING";
  return { id: courseId, title: "AI/ML Ignition", slug: "ai-ml-ignition", code: free ? "GIT-EVERGREEN" : "AI-ML-2026-B1", intakeKey: free ? "EVERGREEN" : "2026-B1", summary: "Practical foundations", level: "BEGINNER", durationValue: 4, durationUnit: "MONTH", price: free ? 0 : 1000, currency: "LKR", courseGroup: { certificateEnabled: false }, status: "OPEN_ACTIVE", category: { status: "PUBLISHED", service: { key: serviceType, status: "ACTIVE", accessType: free ? "FREE" : "PAID", courseMode: free ? "EVERGREEN" : "SEASONAL", enrollmentMode: free ? "SELF" : "ADMIN", paymentRequirement: free ? "NOT_REQUIRED" : "REQUIRED" } }, ...overrides };
}

function studentFixture(id = userId) { return { id, email: `${id}@example.com`, firstName: "Test", lastName: "Student", role: "STUDENT", emailVerified: true }; }

function enrollmentFixture(overrides = {}) {
  const source = overrides.source ?? "ADMIN";
  return { id: "90000000-0000-4000-8000-000000000006", userId, courseId, source, status: "ACTIVE", paymentStatus: source === "SELF" ? "NOT_REQUIRED" : "COMPLETED", paymentCompletedAt: source === "SELF" ? null : new Date(), externalPaymentReference: null, paymentNote: null, completedAt: null, createdAt: new Date(), updatedAt: new Date(), user: studentFixture(), enrolledBy: null, certificates: [], course: courseFixture(source === "SELF" ? "FREE_LEARNING" : "BOOTCAMPS"), ...overrides };
}

describe("course enrollment service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("manually enrolls a verified student in an open paid course", async () => {
    courseRepository.findById.mockResolvedValue(courseFixture());
    userRepository.findUserById.mockResolvedValue(studentFixture());
    enrollmentRepository.createPaid.mockResolvedValue(enrollmentFixture());
    const result = await enrollStudentInCourseService(courseId, { userId }, actorId);
    expect(enrollmentRepository.createPaid).toHaveBeenCalledWith(courseId, userId, actorId, expect.objectContaining({ paymentStatus: "COMPLETED", paymentCompletedAt: expect.any(Date) }));
    expect(result.courseId).toBe(courseId);
  });

  it("rejects manual enrollment when a paid intake is closed", async () => {
    courseRepository.findById.mockResolvedValue(courseFixture("BOOTCAMPS", { status: "CLOSED_ACTIVE" }));
    userRepository.findUserById.mockResolvedValue(studentFixture());
    await expect(enrollStudentInCourseService(courseId, { userId }, actorId)).rejects.toMatchObject({ code: "COURSE_ENROLLMENT_CLOSED" });
  });

  it("returns per-student bulk failures without hiding duplicates", async () => {
    courseRepository.findById.mockResolvedValue(courseFixture());
    userRepository.findVerifiedStudentsByIds.mockResolvedValue([studentFixture(), studentFixture(secondUserId)]);
    enrollmentRepository.createPaid.mockResolvedValueOnce(enrollmentFixture()).mockRejectedValueOnce(new ConflictError("Already enrolled."));
    const result = await bulkEnrollStudentsInCourseService(courseId, { students: [{ userId }, { userId: secondUserId }] }, actorId);
    expect(result.summary).toEqual({ requested: 2, created: 1, failed: 1 });
  });

  it("stops opening transactions once course capacity is exhausted", async () => {
    courseRepository.findById.mockResolvedValue(courseFixture());
    userRepository.findVerifiedStudentsByIds.mockResolvedValue([studentFixture(), studentFixture(secondUserId)]);
    enrollmentRepository.createPaid.mockRejectedValueOnce(new CourseCapacityReachedError());
    const result = await bulkEnrollStudentsInCourseService(courseId, { students: [{ userId }, { userId: secondUserId }] }, actorId);
    expect(enrollmentRepository.createPaid).toHaveBeenCalledTimes(1);
    expect(result.results.every(({ code }) => code === "COURSE_CAPACITY_REACHED")).toBe(true);
  });

  it("keeps free self-enrollment idempotent", async () => {
    const course = courseFixture("FREE_LEARNING");
    courseRepository.findPublishedFreeById.mockResolvedValue(course);
    userRepository.findUserById.mockResolvedValue(studentFixture());
    enrollmentRepository.enrollFree.mockResolvedValue({ enrollment: enrollmentFixture({ source: "SELF", course }), outcome: "EXISTING" });
    const result = await selfEnrollFreeCourseService(courseId, { id: userId, role: "STUDENT" });
    expect(result).toMatchObject({ created: false, reactivated: false });
    expect(recordActionService).not.toHaveBeenCalled();
  });

  it("reactivates the same cancelled free enrollment", async () => {
    const course = courseFixture("FREE_LEARNING");
    courseRepository.findPublishedFreeById.mockResolvedValue(course);
    userRepository.findUserById.mockResolvedValue(studentFixture());
    enrollmentRepository.enrollFree.mockResolvedValue({ enrollment: enrollmentFixture({ source: "SELF", course }), outcome: "REACTIVATED" });
    const result = await selfEnrollFreeCourseService(courseId, { id: userId, role: "STUDENT" });
    expect(result.reactivated).toBe(true);
  });

  it("keeps completed enrollment status and payment terminal", async () => {
    enrollmentRepository.findById.mockResolvedValue(enrollmentFixture({ status: "COMPLETED", completedAt: new Date() }));
    await expect(updateEnrollmentService("90000000-0000-4000-8000-000000000006", { paymentStatus: "PARTIAL" }, actorId)).rejects.toThrow(/terminal/i);
  });

  it("returns cursor pagination for eligible students scoped to a course", async () => {
    courseRepository.findById.mockResolvedValue(courseFixture());
    const students = [studentFixture(), studentFixture(secondUserId), studentFixture("90000000-0000-4000-8000-000000000008")];
    enrollmentRepository.searchEligibleStudents.mockResolvedValue(students);
    const result = await getEligibleStudentsForCourseService(courseId, { q: "test", limit: "2" });
    expect(result.pagination).toMatchObject({ limit: 2, hasMore: true, nextCursor: expect.any(String) });
    expect(enrollmentRepository.searchEligibleStudents).toHaveBeenCalledWith(courseId, "test", 2, null);
  });
});
