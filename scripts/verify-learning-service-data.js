import prisma from "../src/utils/prisma.js";

const services = await prisma.learningService.findMany({
  select: {
    id: true,
    key: true,
    accessType: true,
    courseMode: true,
    enrollmentMode: true,
    paymentRequirement: true,
    _count: { select: { categories: true } },
  },
});
const orphanCategories = await prisma.$queryRawUnsafe(
  "SELECT COUNT(*)::int AS count FROM categories WHERE service_id IS NULL",
);
const storedCoursePolicyColumns = await prisma.$queryRawUnsafe(
  "SELECT COUNT(*)::int AS count FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'courses' AND column_name IN ('access_type', 'instance_kind')",
);

const unsupported = services.filter((service) => {
  const paid = service.accessType === "PAID"
    && service.courseMode === "SEASONAL"
    && service.enrollmentMode === "ADMIN"
    && service.paymentRequirement === "REQUIRED";
  const free = service.accessType === "FREE"
    && service.courseMode === "EVERGREEN"
    && service.enrollmentMode === "SELF"
    && service.paymentRequirement === "NOT_REQUIRED";
  return !paid && !free;
});

const result = {
  serviceCount: services.length,
  categoryCount: services.reduce((sum, service) => sum + service._count.categories, 0),
  orphanCategoryCount: orphanCategories[0]?.count ?? -1,
  storedCoursePolicyColumnCount: storedCoursePolicyColumns[0]?.count ?? -1,
  unsupportedServiceKeys: unsupported.map(({ key }) => key),
};

console.log(JSON.stringify(result, null, 2));

if (
  services.length < 3
  || result.orphanCategoryCount !== 0
  || result.storedCoursePolicyColumnCount !== 0
  || result.unsupportedServiceKeys.length > 0
) {
  process.exitCode = 1;
}

await prisma.$disconnect();
