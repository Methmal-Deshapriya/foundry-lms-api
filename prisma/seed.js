import prisma from "../src/utils/prisma.js";
import { CATALOG_SEED } from "./seed-data/catalog.js";

const SERVICE_PREFIX = {
  BOOTCAMPS: "BC",
  PRETECH: "PT",
  FREE_LEARNING: "FREE",
};

const LEARNING_SERVICES = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    key: "BOOTCAMPS",
    slug: "bootcamps",
    title: "Bootcamps",
    description: "Paid professional programs delivered through seasonal course intakes.",
    accessType: "PAID",
    courseMode: "SEASONAL",
    enrollmentMode: "ADMIN",
    paymentRequirement: "REQUIRED",
    status: "ACTIVE",
    sortOrder: 1,
  },
  {
    id: "20000000-0000-4000-8000-000000000002",
    key: "PRETECH",
    slug: "pretech-courses",
    title: "PreTech Courses",
    description: "Paid preparation programs delivered through seasonal course intakes.",
    accessType: "PAID",
    courseMode: "SEASONAL",
    enrollmentMode: "ADMIN",
    paymentRequirement: "REQUIRED",
    status: "ACTIVE",
    sortOrder: 2,
  },
  {
    id: "20000000-0000-4000-8000-000000000003",
    key: "FREE_LEARNING",
    slug: "free-learning",
    title: "Free Learning",
    description: "Self-paced courses available through free enrollment.",
    accessType: "FREE",
    courseMode: "EVERGREEN",
    enrollmentMode: "SELF",
    paymentRequirement: "NOT_REQUIRED",
    status: "ACTIVE",
    sortOrder: 3,
  },
];

function codePart(value) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

async function seedCatalog() {
  let groupCount = 0;
  let courseCount = 0;
  const serviceByKey = new Map();

  for (const definition of LEARNING_SERVICES) {
    const service = await prisma.learningService.upsert({
      where: { key: definition.key },
      update: definition,
      create: definition,
    });
    serviceByKey.set(service.key, service);
  }

  for (const categoryData of CATALOG_SEED) {
    const { courses, serviceType, ...categoryFields } = categoryData;
    const service = serviceByKey.get(serviceType);
    if (!service) throw new Error(`Missing seeded LearningService ${serviceType}.`);
    const category = await prisma.category.upsert({
      where: {
        serviceId_slug: {
          serviceId: service.id,
          slug: categoryFields.slug,
        },
      },
      update: { ...categoryFields, serviceId: service.id },
      create: { ...categoryFields, serviceId: service.id },
    });

    for (const source of courses) {
      const prefix = `${SERVICE_PREFIX[service.key]}-${codePart(source.slug)}`;
      const group = await prisma.courseGroup.upsert({
        where: {
          categoryId_slug: { categoryId: category.id, slug: source.slug },
        },
        update: { title: source.title, batchCodePrefix: prefix, archivedAt: null },
        create: {
          categoryId: category.id,
          slug: source.slug,
          title: source.title,
          batchCodePrefix: prefix,
          certificateEnabled: source.certificateEnabled,
        },
      });
      const isFree = service.accessType === "FREE";
      const intakeKey = isFree ? "EVERGREEN" : "2026-B1";
      const {
        status: _legacyStatus,
        accessType: _legacyAccessType,
        certificateEnabled: _legacyCertificateEnabled,
        ...publicFields
      } = source;
      const courseIdentity = {
        courseGroupId_intakeKey: { courseGroupId: group.id, intakeKey },
      };
      const updateCourseData = {
          ...publicFields,
          categoryId: category.id,
          title: group.title,
          slug: group.slug,
          code: `${prefix}-${intakeKey}`,
          startDate: isFree ? null : new Date("2026-08-01"),
          expectedEndDate: isFree ? null : new Date("2026-12-01"),
          timezone: "Asia/Colombo",
          capacity: isFree ? null : 50,
          price: isFree ? 0 : Number(source.price) > 0 ? source.price : 1000,
          currency: "LKR",
          status: "DRAFT",
      };
      const createCourseData = {
          ...publicFields,
          courseGroupId: group.id,
          categoryId: category.id,
          title: group.title,
          slug: group.slug,
          intakeKey,
          code: `${prefix}-${intakeKey}`,
          startDate: isFree ? null : new Date("2026-08-01"),
          expectedEndDate: isFree ? null : new Date("2026-12-01"),
          timezone: "Asia/Colombo",
          capacity: isFree ? null : 50,
          price: isFree ? 0 : Number(source.price) > 0 ? source.price : 1000,
          currency: "LKR",
          status: "DRAFT",
      };
      try {
        const existingCourse = await prisma.course.findUnique({
          where: courseIdentity,
          select: { id: true },
        });
        if (existingCourse) {
          await prisma.course.update({
            where: { id: existingCourse.id },
            data: updateCourseData,
          });
        } else {
          await prisma.course.create({ data: createCourseData });
        }
      } catch (error) {
        const codeOwner = await prisma.course.findUnique({
          where: { code: `${prefix}-${intakeKey}` },
          select: { id: true, courseGroupId: true, intakeKey: true, code: true },
        });
        throw new Error(
          `Could not seed Course ${service.key}/${category.slug}/${group.slug}/${intakeKey}. Existing code owner: ${JSON.stringify(codeOwner)}.`,
          { cause: error },
        );
      }
      groupCount += 1;
      courseCount += 1;
    }
  }

  console.log(`Catalog seed complete: ${LEARNING_SERVICES.length} services, ${CATALOG_SEED.length} categories, ${groupCount} course groups, and ${courseCount} draft course records.`);
}

async function seedLearningDeliveryExamples() {
  const freeCourse = await prisma.course.findFirst({
    where: {
      slug: "intro-to-software-engineering",
      category: { service: { key: "FREE_LEARNING" } },
    },
  });
  const paidCourse = await prisma.course.findFirst({
    where: {
      slug: "ml-fundamentals",
      category: { service: { key: "BOOTCAMPS" } },
    },
  });
  if (!freeCourse || !paidCourse) {
    throw new Error("Delivery examples require the seeded free and paid courses.");
  }

  const sharedSession = await prisma.session.upsert({
    where: { id: "10000000-0000-4000-8000-000000000001" },
    update: {
      title: "How Foundry Learning Works",
      description: "Example reusable lesson resource for development.",
      recordingUrl: "https://example.com/foundry/how-learning-works",
      status: "READY",
    },
    create: {
      id: "10000000-0000-4000-8000-000000000001",
      title: "How Foundry Learning Works",
      description: "Example reusable lesson resource for development.",
      recordingUrl: "https://example.com/foundry/how-learning-works",
      status: "READY",
    },
  });
  const paidSession = await prisma.session.upsert({
    where: { id: "10000000-0000-4000-8000-000000000002" },
    update: {
      title: "Machine Learning Orientation",
      description: "Example reusable lesson resource for development.",
      recordingUrl: "https://example.com/foundry/ml-orientation",
      status: "READY",
    },
    create: {
      id: "10000000-0000-4000-8000-000000000002",
      title: "Machine Learning Orientation",
      description: "Example reusable lesson resource for development.",
      recordingUrl: "https://example.com/foundry/ml-orientation",
      status: "READY",
    },
  });

  await prisma.courseSession.upsert({
    where: { courseId_sessionId: { courseId: freeCourse.id, sessionId: sharedSession.id } },
    update: {
      orderIndex: 0,
      retiredAt: null,
      historicalOrderIndex: null,
      deliveryStatus: "RELEASED",
      firstReleasedAt: new Date(),
      availableAt: null,
    },
    create: {
      courseId: freeCourse.id,
      sessionId: sharedSession.id,
      orderIndex: 0,
      deliveryStatus: "RELEASED",
      firstReleasedAt: new Date(),
    },
  });
  await prisma.courseSession.upsert({
    where: { courseId_sessionId: { courseId: paidCourse.id, sessionId: sharedSession.id } },
    update: { orderIndex: 0, retiredAt: null, historicalOrderIndex: null },
    create: { courseId: paidCourse.id, sessionId: sharedSession.id, orderIndex: 0 },
  });
  await prisma.courseSession.upsert({
    where: { courseId_sessionId: { courseId: paidCourse.id, sessionId: paidSession.id } },
    update: { orderIndex: 1, retiredAt: null, historicalOrderIndex: null },
    create: { courseId: paidCourse.id, sessionId: paidSession.id, orderIndex: 1 },
  });

  await prisma.course.update({ where: { id: freeCourse.id }, data: { status: "OPEN_ACTIVE" } });
  await prisma.course.update({ where: { id: paidCourse.id }, data: { status: "OPEN_ACTIVE" } });

  console.log("Delivery seed complete: two reusable sessions, one open paid intake, and one released evergreen free course.");
}

seedCatalog()
  .then(seedLearningDeliveryExamples)
  .catch((error) => {
    console.error("Catalog seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
