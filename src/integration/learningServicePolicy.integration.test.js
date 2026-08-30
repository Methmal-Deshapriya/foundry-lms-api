import { afterAll, beforeAll, describe, expect, it } from "vitest";
import prisma from "../utils/prisma.js";
import { getPublicCategoriesService } from "../services/v1/catalog/catalog.service.js";
import { listPublicLearningServicesService } from "../services/v1/catalog/learningService.service.js";

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === "1";
const ids = {
  paidService: "e1000000-0000-4000-8000-000000000001",
  freeService: "e1000000-0000-4000-8000-000000000002",
  paidCategory: "e1000000-0000-4000-8000-000000000003",
  freeCategory: "e1000000-0000-4000-8000-000000000004",
  paidCourse: "e1000000-0000-4000-8000-000000000005",
  freeCourse: "e1000000-0000-4000-8000-000000000006",
  user: "e1000000-0000-4000-8000-000000000007",
};

// The real-world program. Price and certificate policy live here now, not
// on the intake — see the 2026-08-30 course-to-program-intake rename plan.
const courseData = ({ id, categoryId, slug, price, certificateEnabled }) => ({
  id,
  categoryId,
  slug,
  title: "Policy verification course",
  summary: "A database policy verification course.",
  description: "A database policy verification course used only by the integration suite.",
  level: "OPEN",
  price,
  currency: "LKR",
  intakeCodePrefix: slug.toUpperCase(),
  certificateEnabled,
});

// One scheduled run of a course. Dates/status live here.
const intakeData = ({ id, courseId, categoryId, intakeKey, seasonal = false, status = "DRAFT" }) => ({
  id,
  courseId,
  categoryId,
  intakeKey,
  code: intakeKey,
  startDate: seasonal ? new Date("2027-01-01") : null,
  expectedEndDate: seasonal ? new Date("2027-03-01") : null,
  status,
});

async function cleanup() {
  await prisma.enrollment.deleteMany({ where: { course: { categoryId: { in: [ids.paidCategory, ids.freeCategory] } } } });
  await prisma.intake.deleteMany({ where: { categoryId: { in: [ids.paidCategory, ids.freeCategory] } } });
  await prisma.course.deleteMany({ where: { categoryId: { in: [ids.paidCategory, ids.freeCategory] } } });
  await prisma.category.deleteMany({ where: { id: { in: [ids.paidCategory, ids.freeCategory] } } });
  await prisma.user.deleteMany({ where: { id: ids.user } });
  for (const id of [ids.paidService, ids.freeService]) {
    const service = await prisma.learningService.findUnique({ where: { id } });
    if (service) {
      if (service.status !== "ARCHIVED") await prisma.learningService.update({ where: { id }, data: { status: "ARCHIVED" } });
      await prisma.learningService.delete({ where: { id } });
    }
  }
}

describe.runIf(runDatabaseIntegration)("LearningService database policy boundary", () => {
  beforeAll(async () => {
    await cleanup();
    await prisma.learningService.createMany({ data: [
      { id: ids.paidService, key: "VERIFY_PAID", slug: "verify-paid", title: "Verify Paid", description: "Paid seasonal database verification service.", accessType: "PAID", courseMode: "SEASONAL", enrollmentMode: "ADMIN", paymentRequirement: "REQUIRED", status: "ACTIVE", sortOrder: 90 },
      { id: ids.freeService, key: "VERIFY_FREE", slug: "verify-free", title: "Verify Free", description: "Free evergreen database verification service.", accessType: "FREE", courseMode: "EVERGREEN", enrollmentMode: "SELF", paymentRequirement: "NOT_REQUIRED", status: "ACTIVE", sortOrder: 91 },
    ] });
    await prisma.category.createMany({ data: [
      { id: ids.paidCategory, serviceId: ids.paidService, slug: "verify-paid-category", title: "Verify Paid Category", description: "Paid policy verification category.", visualKey: "sparkles", status: "PUBLISHED" },
      { id: ids.freeCategory, serviceId: ids.freeService, slug: "verify-free-category", title: "Verify Free Category", description: "Free policy verification category.", visualKey: "sparkles", status: "PUBLISHED" },
    ] });
    await prisma.course.createMany({ data: [
      courseData({ id: ids.paidCourse, categoryId: ids.paidCategory, slug: "verify-paid-course", price: 1000, certificateEnabled: true }),
      courseData({ id: ids.freeCourse, categoryId: ids.freeCategory, slug: "verify-free-course", price: 0, certificateEnabled: false }),
    ] });
    await prisma.user.create({ data: { id: ids.user, firstName: "Policy", lastName: "Student", email: "policy-verification@foundry.test", password: "integration-test-only", role: "STUDENT", emailVerified: true } });
  }, 60_000);

  afterAll(cleanup, 60_000);

  it("preserves the migrated service/category relation", async () => {
    expect(await prisma.learningService.count()).toBeGreaterThanOrEqual(5);
    const [orphanCount] = await prisma.$queryRaw`SELECT COUNT(*)::int AS count FROM categories WHERE service_id IS NULL`;
    expect(orphanCount.count).toBe(0);
  });

  it("discovers an additional supported service and resolves its public slug without code registration", async () => {
    const discovery = await listPublicLearningServicesService();
    expect(discovery.services).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.freeService, key: "VERIFY_FREE", slug: "verify-free" }),
    ]));

    const catalog = await getPublicCategoriesService("verify-free");
    expect(catalog.serviceId).toBe(ids.freeService);
    expect(catalog.categories).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids.freeCategory, serviceSlug: "verify-free" }),
    ]));
  });

  it("blocks direct identity rewriting and category movement", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE learning_services SET key = 'REWRITTEN' WHERE id = $1`, ids.paidService)).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe(`UPDATE learning_services SET slug = 'rewritten' WHERE id = $1`, ids.paidService)).rejects.toBeTruthy();
    await expect(prisma.$executeRawUnsafe(`UPDATE categories SET service_id = $1 WHERE id = $2`, ids.freeService, ids.paidCategory)).rejects.toBeTruthy();
    await expect(prisma.course.update({ where: { id: ids.paidCourse }, data: { certificateEnabled: false } })).rejects.toBeTruthy();
  });

  it("enforces course pricing policy without the API", async () => {
    await expect(prisma.course.create({ data: courseData({ id: "e1000000-0000-4000-8000-000000000010", categoryId: ids.freeCategory, slug: "verify-free-bad-price", price: 1, certificateEnabled: false }) })).rejects.toBeTruthy();
    await expect(prisma.course.create({ data: courseData({ id: "e1000000-0000-4000-8000-000000000011", categoryId: ids.paidCategory, slug: "verify-paid-bad-price", price: 0, certificateEnabled: true }) })).rejects.toBeTruthy();
  });

  it("enforces intake date shape without the API", async () => {
    await expect(prisma.intake.create({ data: intakeData({ id: "e1000000-0000-4000-8000-000000000012", courseId: ids.paidCourse, categoryId: ids.paidCategory, intakeKey: "VERIFY-PAID-NO-DATES" }) })).rejects.toBeTruthy();
  });

  it("serializes concurrent evergreen inserts", async () => {
    const attempts = await Promise.allSettled([
      prisma.intake.create({ data: intakeData({ id: "e1000000-0000-4000-8000-000000000020", courseId: ids.freeCourse, categoryId: ids.freeCategory, intakeKey: "VERIFY-FREE-A" }) }),
      prisma.intake.create({ data: intakeData({ id: "e1000000-0000-4000-8000-000000000021", courseId: ids.freeCourse, categoryId: ids.freeCategory, intakeKey: "VERIFY-FREE-B" }) }),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
  }, 60_000);

  it("enforces enrollment source/payment and blocks service archive with active learning", async () => {
    const freeIntake = await prisma.intake.findFirstOrThrow({ where: { courseId: ids.freeCourse } });
    await expect(prisma.enrollment.create({ data: { userId: ids.user, courseId: ids.freeCourse, intakeId: freeIntake.id, source: "ADMIN", paymentStatus: "NOT_REQUIRED" } })).rejects.toBeTruthy();
    const freeEnrollment = await prisma.enrollment.create({ data: { userId: ids.user, courseId: ids.freeCourse, intakeId: freeIntake.id, source: "SELF", paymentStatus: "NOT_REQUIRED" } });
    await expect(prisma.certificate.create({
      data: {
        enrollmentId: freeEnrollment.id,
        certificateCode: "VERIFY-FREE-CERTIFICATE-BLOCKED",
        studentName: "Policy Student",
        courseName: "Policy verification course",
        issuedDate: new Date(),
        certificateData: {},
      },
    })).rejects.toBeTruthy();

    await prisma.intake.create({ data: intakeData({ id: "e1000000-0000-4000-8000-000000000030", courseId: ids.paidCourse, categoryId: ids.paidCategory, intakeKey: "VERIFY-PAID-ACTIVE", seasonal: true, status: "OPEN_ACTIVE" }) });
    await expect(prisma.learningService.update({ where: { id: ids.paidService }, data: { status: "ARCHIVED" } })).rejects.toBeTruthy();
  });
});
