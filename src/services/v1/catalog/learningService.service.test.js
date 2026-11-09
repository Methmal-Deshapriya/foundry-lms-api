import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../repositories/v1/catalog/learningService.repository.js", () => ({
  create: vi.fn(),
  findAdmin: vi.fn(),
  findAdminSummaries: vi.fn(),
  findById: vi.fn(),
  update: vi.fn(),
  transitionStatus: vi.fn(),
}));
vi.mock("../audit/audit.service.js", () => ({ recordActionService: vi.fn() }));
vi.mock("./publicCatalogCache.service.js", () => ({ revalidatePublicCatalogCache: vi.fn() }));
vi.mock("../storage/storedObject.service.js", () => ({ assertAttachableStoredObject: vi.fn().mockResolvedValue({ id: "stored-object", status: "READY" }) }));

import * as repository from "../../../repositories/v1/catalog/learningService.repository.js";
import {
  createLearningServiceService,
  listLearningServicesService,
  transitionLearningServiceStatusService,
  updateLearningServiceService,
} from "./learningService.service.js";

const heroImageObjectId = "30000000-0000-4000-8000-000000000001";
const cardImageObjectId = "30000000-0000-4000-8000-000000000002";
const processSteps = [
  { title: "Step one", description: "Description for step one." },
  { title: "Step two", description: "Description for step two." },
  { title: "Step three", description: "Description for step three." },
  { title: "Step four", description: "Description for step four." },
];
const faqItems = [
  { question: "Question one?", answer: "Answer to question one." },
  { question: "Question two?", answer: "Answer to question two." },
  { question: "Question three?", answer: "Answer to question three." },
];

const paidService = {
  id: "20000000-0000-4000-8000-000000000010",
  key: "CAREER_LABS",
  slug: "career-labs",
  title: "Career Labs",
  description: "Paid seasonal career labs for verified learners.",
  accessType: "PAID",
  courseMode: "SEASONAL",
  enrollmentMode: "ADMIN",
  paymentRequirement: "REQUIRED",
  status: "DRAFT",
  sortOrder: 4,
  summary: "Paid seasonal career labs.",
  heroHeadline: "Build your career with hands-on labs",
  heroTags: ["Practical learning", "Beginner-friendly pathways"],
  heroImageObjectId,
  cardImageObjectId,
  processSteps,
  faqItems,
  _count: { courses: 0 },
};

describe("learning-service domain", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates only a supported policy profile as draft", async () => {
    repository.create.mockResolvedValue(paidService);
    const result = await createLearningServiceService({
      ...paidService,
      id: undefined,
      status: undefined,
      _count: undefined,
    }, "actor-1");
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ status: "DRAFT" }));
    expect(result).toMatchObject({ key: "CAREER_LABS", courseCount: 0 });
  });

  it("rejects a policy combination without an implemented workflow", async () => {
    await expect(createLearningServiceService({
      key: "SELF_PAID",
      slug: "self-paid",
      title: "Self Paid",
      description: "An unsupported paid self-service workflow.",
      accessType: "PAID",
      courseMode: "SEASONAL",
      enrollmentMode: "SELF",
      paymentRequirement: "REQUIRED",
      sortOrder: 5,
    }, "actor-1")).rejects.toMatchObject({ statusCode: 400 });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("validates the complete resulting policy on partial updates", async () => {
    repository.findById.mockResolvedValue(paidService);
    await expect(updateLearningServiceService(paidService.id, { enrollmentMode: "SELF" }, "actor-1"))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("uses optimistic lifecycle state", async () => {
    repository.transitionStatus.mockResolvedValue({ ...paidService, status: "ACTIVE" });
    await transitionLearningServiceStatusService(paidService.id, "ACTIVE", { expectedStatus: "DRAFT" }, "actor-1");
    expect(repository.transitionStatus).toHaveBeenCalledWith(paidService.id, "DRAFT", "ACTIVE");
  });

  it("joins operational summaries without one request per service", async () => {
    repository.findAdmin.mockResolvedValue({ total: 1, services: [paidService] });
    repository.findAdminSummaries.mockResolvedValue([{ serviceId: paidService.id, courseTotal: 2 }]);
    const result = await listLearningServicesService({ includeArchived: "true" });
    expect(result.services[0]).toMatchObject({ id: paidService.id, courses: { total: 2 } });
    expect(repository.findAdminSummaries).toHaveBeenCalledWith([paidService.id]);
  });
});
