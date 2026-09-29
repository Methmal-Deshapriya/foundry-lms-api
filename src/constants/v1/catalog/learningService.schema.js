import { z } from "zod";

export const LEARNING_ACCESS_TYPES = Object.freeze(["FREE", "PAID"]);
export const LEARNING_COURSE_MODES = Object.freeze(["SEASONAL", "EVERGREEN"]);
export const LEARNING_ENROLLMENT_MODES = Object.freeze(["ADMIN", "SELF"]);
export const LEARNING_PAYMENT_REQUIREMENTS = Object.freeze(["REQUIRED", "NOT_REQUIRED"]);
export const LEARNING_SERVICE_STATUSES = Object.freeze(["DRAFT", "ACTIVE", "ARCHIVED"]);

const key = z.string().trim().min(2).max(60).regex(/^[A-Z0-9]+(?:_[A-Z0-9]+)*$/);
const slug = z.string().trim().min(2).max(100).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const policyFields = {
  accessType: z.enum(LEARNING_ACCESS_TYPES),
  courseMode: z.enum(LEARNING_COURSE_MODES),
  enrollmentMode: z.enum(LEARNING_ENROLLMENT_MODES),
  paymentRequirement: z.enum(LEARNING_PAYMENT_REQUIREMENTS),
};

function supportedPolicy(data, context) {
  const paid = data.accessType === "PAID" && data.courseMode === "SEASONAL" && data.enrollmentMode === "ADMIN" && data.paymentRequirement === "REQUIRED";
  const free = data.accessType === "FREE" && data.courseMode === "EVERGREEN" && data.enrollmentMode === "SELF" && data.paymentRequirement === "NOT_REQUIRED";
  if (!paid && !free) context.addIssue({ code: "custom", path: ["accessType"], message: "This learning-service policy combination is not supported yet." });
}

// The public Level-2 page's content, all mandatory from creation onward —
// see the 2026-09-24 dynamic service content plan. Existing rows created
// before this (the 3 seeded real services, plus anything created under the
// earlier Stage 1 schema) can still have these empty/short at the DB level;
// only new writes through this schema are held to the fuller bar.
const summary = z.string().trim().min(10).max(200);
const heroHeadline = z.string().trim().min(3).max(200);
const heroTags = z.array(z.string().trim().min(2).max(40)).length(2, "Provide exactly 2 hero tags.");
const heroImageObjectId = z.string().uuid();
const cardImageObjectId = z.string().uuid();
const processStep = z.object({
  title: z.string().trim().min(2).max(60),
  description: z.string().trim().min(5).max(200),
}).strict();
const processSteps = z.array(processStep).length(4, "Provide exactly 4 steps.");
const faqItem = z.object({
  question: z.string().trim().min(5).max(200),
  answer: z.string().trim().min(5).max(800),
}).strict();
const faqItems = z.array(faqItem).min(3, "Provide at least 3 FAQ items.").max(12);

export const createLearningServiceSchema = z.object({
  key,
  slug,
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(10).max(600),
  ...policyFields,
  sortOrder: z.number().int().min(0).default(0),
  summary,
  heroHeadline,
  heroTags,
  cardImageObjectId,
  heroImageObjectId,
  processSteps,
  faqItems,
}).superRefine(supportedPolicy);

export const updateLearningServiceSchema = z.object({
  slug: slug.optional(),
  title: z.string().trim().min(3).max(120).optional(),
  description: z.string().trim().min(10).max(600).optional(),
  accessType: policyFields.accessType.optional(),
  courseMode: policyFields.courseMode.optional(),
  enrollmentMode: policyFields.enrollmentMode.optional(),
  paymentRequirement: policyFields.paymentRequirement.optional(),
  sortOrder: z.number().int().min(0).optional(),
  summary: summary.optional(),
  heroHeadline: heroHeadline.optional(),
  heroTags: heroTags.optional(),
  cardImageObjectId: cardImageObjectId.optional(),
  heroImageObjectId: heroImageObjectId.optional(),
  processSteps: processSteps.optional(),
  faqItems: faqItems.optional(),
}).refine((data) => Object.keys(data).length > 0, "At least one field is required.");

export const learningServiceAdminFiltersSchema = z.object({
  status: z.enum(LEARNING_SERVICE_STATUSES).optional(),
  includeArchived: z.coerce.boolean().default(true),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const learningServiceStatusSchema = z.object({
  expectedStatus: z.enum(LEARNING_SERVICE_STATUSES),
});

export function isSupportedLearningServicePolicy(service) {
  return (
    (service.accessType === "PAID" && service.courseMode === "SEASONAL" && service.enrollmentMode === "ADMIN" && service.paymentRequirement === "REQUIRED") ||
    (service.accessType === "FREE" && service.courseMode === "EVERGREEN" && service.enrollmentMode === "SELF" && service.paymentRequirement === "NOT_REQUIRED")
  );
}
