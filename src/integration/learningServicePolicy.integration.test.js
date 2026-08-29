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
  paidGroup: "e1000000-0000-4000-8000-000000000005",
  freeGroup: "e1000000-0000-4000-8000-000000000006",
  user: "e1000000-0000-4000-8000-000000000007",
};

const courseData = ({ id, groupId, categoryId, code, price, seasonal = false, status = "DRAFT" }) => ({
  id,
  courseGroupId: groupId,
  categoryId,
  slug: code.toLowerCase(),
  title: "Policy verification course",
  summary: "A database policy verification course.",
  description: "A database policy verification course used only by the integration suite.",
  level: "OPEN",
  intakeKey: code,
  code,
  startDate: seasonal ? new Date("2027-01-01") : null,
  expectedEndDate: seasonal ? new Date("2027-03-01") : null,
  price,
  status,
});

async function cleanup() {
  await prisma.enrollment.deleteMany({ where: { course: { categoryId: { in: [ids.paidCategory, ids.freeCategory] } } } });
  await prisma.course.deleteMany({ where: { categoryId: { in: [ids.paidCategory, ids.freeCategory] } } });
  await prisma.courseGroup.deleteMany({ where: { id: { in: [ids.paidGroup, ids.freeGroup] } } });
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
    await prisma.courseGroup.createMany({ data: [
      { id: ids.paidGroup, categoryId: ids.paidCategory, slug: "verify-paid-course", title: "Verify Paid Course", batchCodePrefix: "VERIFY-PAID", certificateEnabled: true },
      { id: ids.freeGroup, categoryId: ids.freeCategory, slug: "verify-free-course", title: "Verify Free Course", batchCodePrefix: "VERIFY-FREE", certificateEnabled: false },
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
    await expect(prisma.courseGroup.update({ where: { id: ids.paidGroup }, data: { certificateEnabled: false } })).rejects.toBeTruthy();
  });

  it("enforces price and intake shape without the API", async () => {
    await expect(prisma.course.create({ data: courseData({ id: "e1000000-0000-4000-8000-000000000010", groupId: ids.freeGroup, categoryId: ids.freeCategory, code: "VERIFY-FREE-BAD-PRICE", price: 1 }) })).rejects.toBeTruthy();
    await expect(prisma.course.create({ data: courseData({ id: "e1000000-0000-4000-8000-000000000011", groupId: ids.paidGroup, categoryId: ids.paidCategory, code: "VERIFY-PAID-BAD-PRICE", price: 0, seasonal: true }) })).rejects.toBeTruthy();
    await expect(prisma.course.create({ data: courseData({ id: "e1000000-0000-4000-8000-000000000012", groupId: ids.paidGroup, categoryId: ids.paidCategory, code: "VERIFY-PAID-NO-DATES", price: 1000 }) })).rejects.toBeTruthy();
  });

  it("serializes concurrent evergreen inserts", async () => {
    const attempts = await Promise.allSettled([
      prisma.course.create({ data: courseData({ id: "e1000000-0000-4000-8000-000000000020", groupId: ids.freeGroup, categoryId: ids.freeCategory, code: "VERIFY-FREE-A", price: 0 }) }),
      prisma.course.create({ data: courseData({ id: "e1000000-0000-4000-8000-000000000021", groupId: ids.freeGroup, categoryId: ids.freeCategory, code: "VERIFY-FREE-B", price: 0 }) }),
    ]);
    expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
  }, 60_000);

  it("enforces enrollment source/payment and blocks service archive with active learning", async () => {
    const freeCourse = await prisma.course.findFirstOrThrow({ where: { courseGroupId: ids.freeGroup } });
    await expect(prisma.enrollment.create({ data: { userId: ids.user, courseId: freeCourse.id, source: "ADMIN", paymentStatus: "NOT_REQUIRED" } })).rejects.toBeTruthy();
    const freeEnrollment = await prisma.enrollment.create({ data: { userId: ids.user, courseId: freeCourse.id, source: "SELF", paymentStatus: "NOT_REQUIRED" } });
    await expect(prisma.certificate.create({
      data: {
        enrollmentId: freeEnrollment.id,
        certificateCode: "VERIFY-FREE-CERTIFICATE-BLOCKED",
        studentName: "Policy Student",
        courseName: freeCourse.title,
        issuedDate: new Date(),
        certificateData: {},
      },
    })).rejects.toBeTruthy();

    await prisma.course.create({ data: courseData({ id: "e1000000-0000-4000-8000-000000000030", groupId: ids.paidGroup, categoryId: ids.paidCategory, code: "VERIFY-PAID-ACTIVE", price: 1000, seasonal: true, status: "OPEN_ACTIVE" }) });
    await expect(prisma.learningService.update({ where: { id: ids.paidService }, data: { status: "ARCHIVED" } })).rejects.toBeTruthy();
  });
});
