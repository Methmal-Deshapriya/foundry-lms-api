import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/courses/courseCurriculum.repository.js", () => ({
  findCurriculum: vi.fn(), attach: vi.fn(), reorder: vi.fn(), remove: vi.fn(), updateDelivery: vi.fn(),
}));
vi.mock("../../../repositories/v1/catalog/intake.repository.js", () => ({ findById: vi.fn() }));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as curriculumRepository from "../../../repositories/v1/courses/courseCurriculum.repository.js";
import * as intakeRepository from "../../../repositories/v1/catalog/intake.repository.js";
import { attachCourseSessionService, getCourseCurriculumService, removeCourseSessionService, reorderCourseCurriculumService, updateCourseSessionDeliveryService } from "./courseCurriculum.service.js";

const intakeId = "20000000-0000-4000-8000-000000000001";
const courseSessionId = "40000000-0000-4000-8000-000000000001";
const sessionId = "50000000-0000-4000-8000-000000000001";

function intakeFixture(overrides = {}) {
  return { id: intakeId, code: "AI-ML-2026-B1", status: "OPEN_ACTIVE", category: { serviceType: "BOOTCAMPS" }, _count: { courseSessions: 1, enrollments: 4 }, ...overrides };
}

function curriculumFixture(overrides = {}) {
  return { id: courseSessionId, intakeId, orderIndex: 0, deliveryStatus: "UNRELEASED", availableAt: null, firstReleasedAt: null, retiredAt: null, historicalOrderIndex: null, session: { id: sessionId, title: "Session 1", status: "READY" }, _count: { completions: 0 }, ...overrides };
}

describe("course curriculum service", () => {
  beforeEach(() => { vi.clearAllMocks(); intakeRepository.findById.mockResolvedValue(intakeFixture()); });

  it("returns explicit intake-level delivery state and retired history on request", async () => {
    curriculumRepository.findCurriculum.mockResolvedValue([curriculumFixture({ deliveryStatus: "RELEASED", firstReleasedAt: new Date() })]);
    const result = await getCourseCurriculumService(intakeId, { includeRetired: "true" });
    expect(curriculumRepository.findCurriculum).toHaveBeenCalledWith(intakeId, true);
    expect(result.curriculum[0]).toMatchObject({ deliveryStatus: "RELEASED", usage: { completionCount: 0 } });
  });

  it("attaches an existing library session only", async () => {
    curriculumRepository.attach.mockResolvedValue(curriculumFixture());
    const result = await attachCourseSessionService(intakeId, { sessionId, orderIndex: 0 }, "actor-1");
    expect(curriculumRepository.attach).toHaveBeenCalledWith(intakeId, sessionId, 0);
    expect(result.courseSession.deliveryStatus).toBe("UNRELEASED");
  });

  it("rejects duplicate or discontinuous ordering", async () => {
    await expect(reorderCourseCurriculumService(intakeId, { courseSessions: [{ id: courseSessionId, orderIndex: 0 }, { id: courseSessionId, orderIndex: 2 }] }, "actor-1")).rejects.toThrow(/continuous from zero/i);
    expect(curriculumRepository.reorder).not.toHaveBeenCalled();
  });

  it("delegates detach-versus-retire decisions to the locked repository", async () => {
    curriculumRepository.remove.mockResolvedValue({ action: "RETIRED" });
    await expect(removeCourseSessionService(intakeId, courseSessionId, "actor-1")).resolves.toEqual({ action: "RETIRED" });
    expect(curriculumRepository.remove).toHaveBeenCalledWith(intakeId, courseSessionId);
  });

  it("validates scheduled availability", async () => {
    await expect(updateCourseSessionDeliveryService(intakeId, courseSessionId, { status: "SCHEDULED" }, "actor-1")).rejects.toMatchObject({ statusCode: 400 });
    expect(curriculumRepository.updateDelivery).not.toHaveBeenCalled();
  });

  it("updates delivery through the transaction repository", async () => {
    curriculumRepository.updateDelivery.mockResolvedValue(curriculumFixture({ deliveryStatus: "RELEASED", firstReleasedAt: new Date() }));
    const result = await updateCourseSessionDeliveryService(intakeId, courseSessionId, { status: "RELEASED" }, "actor-1");
    expect(curriculumRepository.updateDelivery).toHaveBeenCalledWith(intakeId, courseSessionId, expect.objectContaining({ status: "RELEASED" }));
    expect(result.deliveryStatus).toBe("RELEASED");
  });
});
