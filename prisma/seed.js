import prisma from "../src/utils/prisma.js";
import { CATALOG_SEED } from "./seed-data/catalog.js";

async function seedCatalog() {
  let courseCount = 0;

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
      await prisma.course.upsert({
        where: {
          categoryId_slug: {
            categoryId: category.id,
            slug: courseFields.slug,
          },
        },
        update: courseFields,
        create: {
          ...courseFields,
          categoryId: category.id,
        },
      });
      courseCount += 1;
    }
  }

  console.log(
    `Catalog seed complete: ${CATALOG_SEED.length} categories and ${courseCount} courses.`,
  );
}

seedCatalog()
  .catch((error) => {
    console.error("Catalog seed failed.", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
