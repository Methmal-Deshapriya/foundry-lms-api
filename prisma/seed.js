import prisma from "../src/utils/prisma.js";
import { CATALOG_SEED } from "./seed-data/catalog.js";

async function seedCatalog() {
  let courseCount = 0;
  let draftPaidCourseCount = 0;

  for (const categoryData of CATALOG_SEED) {
    const { courses, ...categoryFields } = categoryData;
    const category = await prisma.category.upsert({
      where: {
        serviceType_slug: {
          serviceType: categoryFields.serviceType,
          slug: categoryFields.slug,
        },
      },
      update: categoryFields,
      create: categoryFields,
    });

    for (const courseFields of courses) {
      const requiresRealPrice =
        categoryFields.serviceType !== "FREE_LEARNING" &&
        Number(courseFields.price) <= 0;
      const normalizedCourseFields = requiresRealPrice
        ? { ...courseFields, status: "DRAFT" }
        : courseFields;
      await prisma.course.upsert({
        where: {
          categoryId_slug: {
            categoryId: category.id,
            slug: courseFields.slug,
          },
        },
        update: normalizedCourseFields,
        create: {
          ...normalizedCourseFields,
          categoryId: category.id,
        },
      });
      if (requiresRealPrice) draftPaidCourseCount += 1;
      courseCount += 1;
    }
  }

  console.log(
    `Catalog seed complete: ${CATALOG_SEED.length} categories and ${courseCount} courses (${draftPaidCourseCount} paid examples kept draft until real pricing is set).`,
  );
}

async function seedLearningDeliveryExamples() {
  const freeCourse = await prisma.course.findFirst({
    where: {
      slug: "intro-to-software-engineering",
      category: { serviceType: "FREE_LEARNING" },
    },
  });
  const paidCourse = await prisma.course.findFirst({
    where: {
      slug: "ml-fundamentals",
      category: { serviceType: "BOOTCAMPS" },
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
      reusePolicy: "REUSABLE",
      status: "READY",
    },
    create: {
      id: "10000000-0000-4000-8000-000000000001",
      title: "How Foundry Learning Works",
      description: "Example reusable lesson resource for development.",
      recordingUrl: "https://example.com/foundry/how-learning-works",
      reusePolicy: "REUSABLE",
      status: "READY",
    },
  });
  const paidSession = await prisma.session.upsert({
    where: { id: "10000000-0000-4000-8000-000000000002" },
    update: {
      title: "Machine Learning Orientation",
      description: "Example one-course lesson resource for development.",
      recordingUrl: "https://example.com/foundry/ml-orientation",
      reusePolicy: "SINGLE_COURSE",
      status: "READY",
    },
    create: {
      id: "10000000-0000-4000-8000-000000000002",
      title: "Machine Learning Orientation",
      description: "Example one-course lesson resource for development.",
      recordingUrl: "https://example.com/foundry/ml-orientation",
      reusePolicy: "SINGLE_COURSE",
      status: "READY",
    },
  });

  const freeLink = await prisma.courseSession.upsert({
    where: {
      courseId_sessionId: { courseId: freeCourse.id, sessionId: sharedSession.id },
    },
    update: { orderIndex: 0, retiredAt: null },
    create: {
      courseId: freeCourse.id,
      sessionId: sharedSession.id,
      orderIndex: 0,
    },
  });
  const paidSharedLink = await prisma.courseSession.upsert({
    where: {
      courseId_sessionId: { courseId: paidCourse.id, sessionId: sharedSession.id },
    },
    update: { orderIndex: 0, retiredAt: null },
    create: {
      courseId: paidCourse.id,
      sessionId: sharedSession.id,
      orderIndex: 0,
    },
  });
  const paidLink = await prisma.courseSession.upsert({
    where: {
      courseId_sessionId: { courseId: paidCourse.id, sessionId: paidSession.id },
    },
    update: { orderIndex: 1, retiredAt: null },
    create: {
      courseId: paidCourse.id,
      sessionId: paidSession.id,
      orderIndex: 1,
    },
  });

  const batch = await prisma.batch.upsert({
    where: { code: "ML-FUNDAMENTALS-DEMO" },
    update: {
      courseId: paidCourse.id,
      name: "Machine Learning Demo Batch",
      startDate: new Date("2026-08-01"),
      expectedEndDate: new Date("2026-12-01"),
      timezone: "Asia/Colombo",
      capacity: 30,
      status: "DRAFT",
    },
    create: {
      courseId: paidCourse.id,
      name: "Machine Learning Demo Batch",
      code: "ML-FUNDAMENTALS-DEMO",
      startDate: new Date("2026-08-01"),
      expectedEndDate: new Date("2026-12-01"),
      timezone: "Asia/Colombo",
      capacity: 30,
      status: "DRAFT",
    },
  });
  for (const [orderIndex, courseSession] of [paidSharedLink, paidLink].entries()) {
    await prisma.batchSession.upsert({
      where: {
        batchId_courseSessionId: {
          batchId: batch.id,
          courseSessionId: courseSession.id,
        },
      },
      update: { orderIndex, isReleased: false, availableAt: null },
      create: {
        batchId: batch.id,
        courseSessionId: courseSession.id,
        courseId: paidCourse.id,
        orderIndex,
        isReleased: false,
      },
    });
  }

  console.log(
    `Delivery seed complete: 2 library sessions, 3 curriculum links, 1 draft batch, and ${freeLink ? 1 : 0} immediately available free lesson.`,
  );
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
