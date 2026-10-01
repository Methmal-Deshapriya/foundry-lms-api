import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/projects/project.repository.js", () => ({
  createForEnrollment: vi.fn(),
  setVisibilityOwned: vi.fn(),
}));
vi.mock("../profiles/profile.service.js", () => ({ hasProfile: vi.fn() }));
vi.mock("../storage/storedObject.service.js", () => ({ assertAttachableStoredObject: vi.fn() }));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));

import * as projectRepo from "../../../repositories/v1/projects/project.repository.js";
import { hasProfile } from "../profiles/profile.service.js";
import { setProjectVisibilityService, submitProjectService } from "./project.service.js";

const student = { id: "student-1", role: "STUDENT" };
const submission = {
  intakeId: "c0000000-0000-4000-8000-000000000001",
  enrollmentId: "c0000000-0000-4000-8000-000000000002",
  title: "Sales dashboard",
};

beforeEach(() => vi.clearAllMocks());

describe("project service (M08-14)", () => {
  it("asks for a public profile before the first submission", async () => {
    hasProfile.mockResolvedValue(false);
    await expect(submitProjectService(student, submission)).rejects.toMatchObject({ code: "PROFILE_REQUIRED" });
    expect(projectRepo.createForEnrollment).not.toHaveBeenCalled();
  });

  it("refuses a visibility change that isn't true or false", async () => {
    await expect(setProjectVisibilityService("project-1", "student-1", { isPublic: "no" })).rejects.toMatchObject({ field: "isPublic" });
    expect(projectRepo.setVisibilityOwned).not.toHaveBeenCalled();
  });

  it("hides a project for its owner", async () => {
    projectRepo.setVisibilityOwned.mockResolvedValue({ id: "project-1", userId: "student-1", isPublic: false, intake: null });
    await expect(setProjectVisibilityService("project-1", "student-1", { isPublic: false })).resolves.toMatchObject({ isPublic: false });
    expect(projectRepo.setVisibilityOwned).toHaveBeenCalledWith("project-1", "student-1", false);
  });
});
