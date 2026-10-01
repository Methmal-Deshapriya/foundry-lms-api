import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/profiles/profile.repository.js", () => ({
  findByUserId: vi.fn(),
  findBySlug: vi.fn(),
  findByPreviousSlug: vi.fn(),
  upsertForUser: vi.fn(),
  setPublishConsent: vi.fn(),
  countApprovedPublicProjects: vi.fn(async () => 1),
  findPublicBySlug: vi.fn(),
}));
vi.mock("../storage/storedObject.service.js", () => ({
  assertAttachableStoredObject: vi.fn(),
  deleteStoredObjectService: vi.fn(async () => undefined),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("../../../config/r2.js", () => ({ publicObjectUrl: vi.fn((key) => `https://cdn.example/${key}`) }));

import * as repository from "../../../repositories/v1/profiles/profile.repository.js";
import { assertAttachableStoredObject, deleteStoredObjectService } from "../storage/storedObject.service.js";
import { getPublicProfileService, saveMyProfileService, setProfilePublishedService } from "./profile.service.js";

const student = { id: "student-1", role: "STUDENT" };
const save = (overrides = {}) => saveMyProfileService(student, { slug: "kasun-perera", publishConsent: true, ...overrides });
const publicRow = (overrides = {}) => ({
  slug: "kasun-perera",
  headline: "Data analyst",
  bio: null,
  interests: [],
  careerGoals: [],
  linkedinUrl: null,
  githubUrl: null,
  portfolioUrl: null,
  publishConsentAt: new Date(),
  avatarObject: null,
  user: { firstName: "Kasun", lastName: "Perera", createdAt: new Date("2026-01-01"), studentProjects: [{ id: "p-1", title: "Dashboard", description: null, thumbnailUrl: null, thumbnailObject: null, technologies: [], githubUrl: null, demoUrl: null, projectUrl: null, intake: { course: { title: "Data" } } }], enrollments: [] },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  repository.findBySlug.mockResolvedValue(null);
  repository.findByPreviousSlug.mockResolvedValue(null);
  repository.upsertForUser.mockImplementation(async (userId, data) => ({ id: "profile-1", userId, ...data }));
  repository.setPublishConsent.mockImplementation(async (userId, publishConsentAt) => ({ id: "profile-1", userId, slug: "kasun-perera", publishConsentAt }));
});

describe("who sees a public profile (M08-14)", () => {
  it("answers 404 for a profile that doesn't exist", async () => {
    repository.findPublicBySlug.mockResolvedValue(null);
    await expect(getPublicProfileService("nobody")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("answers 404 once the student withdrew consent, like a missing profile", async () => {
    repository.findPublicBySlug.mockResolvedValue(publicRow({ publishConsentAt: null }));
    await expect(getPublicProfileService("kasun-perera")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("answers 404 until a project is approved and public", async () => {
    repository.findPublicBySlug.mockResolvedValue(publicRow({ user: { ...publicRow().user, studentProjects: [] } }));
    await expect(getPublicProfileService("kasun-perera")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("returns only the allow-listed fields", async () => {
    repository.findPublicBySlug.mockResolvedValue(publicRow());
    const result = await getPublicProfileService("kasun-perera");
    expect(Object.keys(result).sort()).toEqual(["achievements", "avatarUrl", "bio", "careerGoals", "headline", "interests", "learningSince", "links", "name", "projects", "slug"]);
  });

  it("sends an old link to the student's current page (M08-09)", async () => {
    repository.findPublicBySlug.mockResolvedValueOnce(null).mockResolvedValueOnce(publicRow({ slug: "kasun-p" }));
    repository.findByPreviousSlug.mockResolvedValue({ userId: "student-1", slug: "kasun-p" });
    await expect(getPublicProfileService("kasun-perera")).resolves.toEqual({ redirectToSlug: "kasun-p" });
  });
});

describe("saving a profile", () => {
  it("refuses a link another student uses now", async () => {
    repository.findByUserId.mockResolvedValue(null);
    repository.findBySlug.mockResolvedValue({ userId: "someone-else" });
    await expect(save()).rejects.toMatchObject({ field: "slug" });
  });

  it("refuses a link another student used before (M08-09)", async () => {
    repository.findByUserId.mockResolvedValue(null);
    repository.findByPreviousSlug.mockResolvedValue({ userId: "someone-else", slug: "their-new-link" });
    await expect(save()).rejects.toMatchObject({ field: "slug" });
  });

  it("remembers the old link when the student changes it", async () => {
    repository.findByUserId.mockResolvedValue({ id: "profile-1", slug: "old-link", previousSlugs: [], publishConsentAt: new Date(), avatarObjectId: null });
    await save({ slug: "new-link" });
    expect(repository.upsertForUser).toHaveBeenCalledWith("student-1", expect.objectContaining({ slug: "new-link", previousSlugs: ["old-link"] }));
  });

  it("keeps a hidden profile hidden when the student edits it", async () => {
    repository.findByUserId.mockResolvedValue({ id: "profile-1", slug: "kasun-perera", previousSlugs: [], publishConsentAt: null, avatarObjectId: null });
    await save({ headline: "New headline" });
    expect(repository.upsertForUser.mock.calls[0][1].publishConsentAt).toBeNull();
  });

  it("publishes a brand-new profile on its first save", async () => {
    repository.findByUserId.mockResolvedValue(null);
    await save();
    expect(repository.upsertForUser.mock.calls[0][1].publishConsentAt).toBeInstanceOf(Date);
  });

  it("only attaches a picture the student uploaded", async () => {
    repository.findByUserId.mockResolvedValue(null);
    await save({ avatarObjectId: "a0000000-0000-4000-8000-000000000001" });
    expect(assertAttachableStoredObject).toHaveBeenCalledWith("a0000000-0000-4000-8000-000000000001", "STUDENT_AVATAR", { ownerUserId: "student-1" });
  });

  it("deletes the old picture only when it changed", async () => {
    const oldAvatar = { id: "b0000000-0000-4000-8000-000000000002" };
    repository.findByUserId.mockResolvedValue({ id: "profile-1", slug: "kasun-perera", previousSlugs: [], publishConsentAt: new Date(), avatarObjectId: "b0000000-0000-4000-8000-000000000002", avatarObject: oldAvatar });
    await save({ avatarObjectId: "b0000000-0000-4000-8000-000000000002" });
    expect(deleteStoredObjectService).not.toHaveBeenCalled();
    await save({ avatarObjectId: null });
    expect(deleteStoredObjectService).toHaveBeenCalledWith(oldAvatar, "student-1");
  });
});

describe("hiding and showing the profile (M08-01)", () => {
  it("clears consent when hidden", async () => {
    repository.findByUserId.mockResolvedValue({ id: "profile-1", slug: "kasun-perera", publishConsentAt: new Date() });
    await setProfilePublishedService(student, false);
    expect(repository.setPublishConsent).toHaveBeenCalledWith("student-1", null);
  });

  it("records consent again when shown", async () => {
    repository.findByUserId.mockResolvedValue({ id: "profile-1", slug: "kasun-perera", publishConsentAt: null });
    await setProfilePublishedService(student, true);
    expect(repository.setPublishConsent.mock.calls[0][1]).toBeInstanceOf(Date);
  });

  it("asks for setup when there is no profile yet", async () => {
    repository.findByUserId.mockResolvedValue(null);
    await expect(setProfilePublishedService(student, false)).rejects.toMatchObject({ statusCode: 404 });
  });
});
