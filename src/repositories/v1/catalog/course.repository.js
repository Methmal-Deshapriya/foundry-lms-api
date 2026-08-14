import prisma from "../../../utils/prisma.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  handlePrismaError,
} from "../../../utils/Errors.js";
import {
  assertDeletionAllowed,
  buildDeletionImpact,
  deleteCourseGraph,
  lockArchivedCourses,
  runSerializableCatalogTransaction,
} from "./catalogDeletion.repository.js";
import { acquireTransactionLock } from "../learning/transactionLock.repository.js";
import { getLearningServicePolicy } from "../../../constants/v1/catalog/learningServicePolicy.constants.js";

const courseInclude = {
  category: true,
  _count: {
    select: {
      courseSessions: { where: { retiredAt: null } },
      batches: true,
      enrollments: true,
    },
  },
};

function assertCourseConfiguration(current, data, { publishing = false } = {}) {
  const durationValue = data.durationValue !== undefined
    ? data.durationValue
    : current.durationValue;
  const durationUnit = data.durationUnit !== undefined
    ? data.durationUnit
    : current.durationUnit;
  if ((durationValue == null) !== (durationUnit == null)) {
    throw new ValidationError(
      "Duration value and unit must be provided together.",
      "durationValue",
    );
  }

  const accessType = data.accessType ?? current.accessType;
  const price = Number(data.price ?? current.price);
  const policy = getLearningServicePolicy(current.category.serviceType);
  if (!policy || accessType !== policy.accessType) {
    throw new ValidationError(
      `${current.category.serviceType} courses must use ${policy?.accessType ?? "the configured"} access.`,
      "accessType",
    );
  }
  if (policy.accessType === "FREE" && price !== 0) {
    throw new ValidationError("Free Learning courses must have a zero price.", "price");
  }
  if (policy.accessType === "PAID" && publishing && price <= 0) {
    throw new ValidationError(
      "Published Bootcamp and PreTech courses must have a price greater than zero.",
      "price",
    );
  }
}

export async function findPublicDetail(serviceType, categorySlug, courseSlug) {
  return prisma.course.findFirst({
    where: {
      slug: courseSlug,
      status: "PUBLISHED",
      category: {
        serviceType,
        slug: categorySlug,
        status: "PUBLISHED",
      },
    },
    include: {
      category: {
        include: {
          courses: {
            where: { status: "PUBLISHED" },
            select: { level: true },
          },
          _count: {
            select: { courses: { where: { status: "PUBLISHED" } } },
          },
        },
      },
    },
  });
}

export async function findById(id) {
  return prisma.course.findUnique({
    where: { id },
    include: courseInclude,
  });
}

export async function findPublishedFreeById(id) {
  return prisma.course.findFirst({
    where: {
      id,
      status: "PUBLISHED",
      accessType: "FREE",
      category: { status: "PUBLISHED", serviceType: "FREE_LEARNING" },
    },
    include: {
      category: true,
      _count: {
        select: { courseSessions: { where: { retiredAt: null } } },
      },
    },
  });
}

export async function updateEnrollmentStatus(id, status) {
  try {
    return await prisma.$transaction(async (transaction) => {
      // Curriculum changes use the same first lock. This makes opening
      // enrollment and removing the final session mutually exclusive.
      await acquireTransactionLock(transaction, `curriculum:${id}`);
      await acquireTransactionLock(transaction, `free-enrollment:${id}`);

      const current = await transaction.course.findUnique({
        where: { id },
        include: {
          category: true,
          _count: {
            select: {
              courseSessions: { where: { retiredAt: null } },
              batches: true,
              enrollments: true,
            },
          },
        },
      });
      if (!current) return null;
      if (
        current.status === "ARCHIVED" ||
        current.category.status === "ARCHIVED"
      ) {
        throw new ConflictError(
          "Archived courses cannot change enrollment availability.",
        );
      }
      if (
        current.category.serviceType !== "FREE_LEARNING" ||
        current.accessType !== "FREE"
      ) {
        throw new ConflictError(
          "Enrollment availability is managed here only for Free Learning courses.",
        );
      }
      if (status === "OPEN" && current._count.courseSessions === 0) {
        throw new ConflictError(
          "Attach at least one session before opening Free Learning enrollment.",
        );
      }

      return transaction.course.update({
        where: { id },
        data: { enrollmentStatus: status },
        include: {
          category: true,
          _count: {
            select: {
              courseSessions: { where: { retiredAt: null } },
              batches: true,
              enrollments: true,
            },
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw handlePrismaError(error);
  }
}

export async function findAdmin(filters, limit, offset) {
  const where = {
    ...(filters.categoryId ? { categoryId: filters.categoryId } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.level ? { level: filters.level } : {}),
    ...(filters.accessType ? { accessType: filters.accessType } : {}),
    ...(filters.serviceType
      ? { category: { serviceType: filters.serviceType } }
      : {}),
    ...(filters.q
      ? {
          OR: [
            { title: { contains: filters.q, mode: "insensitive" } },
            { slug: { contains: filters.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, courses] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      orderBy: [
        { category: { serviceType: "asc" } },
        { category: { sortOrder: "asc" } },
        { sortOrder: "asc" },
        { title: "asc" },
      ],
      take: limit,
      skip: offset,
      include: {
        category: true,
        _count: {
          select: {
            courseSessions: { where: { retiredAt: null } },
            batches: true,
            enrollments: true,
          },
        },
      },
    }),
  ]);

  return { total, courses };
}

export async function create(data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(
        transaction,
        `catalog-category:${data.categoryId}`,
      );
      const category = await transaction.category.findUnique({
        where: { id: data.categoryId },
        select: { status: true },
      });
      if (!category) throw new ConflictError("Category no longer exists.");
      if (category.status === "ARCHIVED") {
        throw new ConflictError("Courses cannot be created under an archived category.");
      }
      return transaction.course.create({
        data,
        include: {
          category: true,
          _count: {
            select: {
              courseSessions: { where: { retiredAt: null } },
              batches: true,
              enrollments: true,
            },
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw handlePrismaError(error);
  }
}

export async function archiveSafely(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `curriculum:${id}`);
      const current = await transaction.course.findUnique({
        where: { id },
        include: {
          category: true,
          _count: {
            select: {
              courseSessions: { where: { retiredAt: null } },
              batches: true,
              enrollments: true,
            },
          },
        },
      });
      if (!current) return null;
      if (current.status === "ARCHIVED") return current;

      const enrollingBatchCount = await transaction.batch.count({
        where: { courseId: id, status: "ENROLLING" },
      });
      if (enrollingBatchCount > 0) {
        throw new ConflictError(
          "Cancel enrolling batches before archiving this course.",
          "CATALOG_ARCHIVE_BLOCKED",
        );
      }
      return transaction.course.update({
        where: { id },
        data: { status: "ARCHIVED" },
        include: {
          category: true,
          _count: {
            select: {
              courseSessions: { where: { retiredAt: null } },
              batches: true,
              enrollments: true,
            },
          },
        },
      });
    });
  } catch (error) {
    if (error instanceof ConflictError) throw error;
    throw handlePrismaError(error);
  }
}

export async function update(id, data) {
  try {
    return await prisma.course.update({
      where: { id },
      data,
      include: {
        category: true,
        _count: {
          select: {
            courseSessions: { where: { retiredAt: null } },
            batches: true,
            enrollments: true,
          },
        },
      },
    });
  } catch (error) {
    throw handlePrismaError(error);
  }
}

export async function updateOperational(id, data) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `curriculum:${id}`);
      const current = await transaction.course.findUnique({
        where: { id },
        include: courseInclude,
      });
      if (!current) throw new NotFoundError("Course not found.");
      if (Object.hasOwn(data, "categoryId")) {
        throw new ConflictError(
          "A course's category is selected at creation and cannot be changed later.",
        );
      }
      if (Object.hasOwn(data, "certificateEnabled")) {
        throw new ConflictError(
          "Certificate support is selected at course creation and cannot be changed later.",
        );
      }
      if (
        current.status === "ARCHIVED" ||
        current.category.status === "ARCHIVED"
      ) {
        throw new ConflictError("Archived courses cannot be edited.");
      }
      assertCourseConfiguration(current, data, {
        publishing: current.status === "PUBLISHED",
      });
      return transaction.course.update({
        where: { id },
        data,
        include: courseInclude,
      });
    });
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof NotFoundError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    throw handlePrismaError(error);
  }
}

export async function setPublication(id, publish) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `curriculum:${id}`);
      const current = await transaction.course.findUnique({
        where: { id },
        include: courseInclude,
      });
      if (!current) throw new NotFoundError("Course not found.");
      if (current.status === "ARCHIVED") {
        throw new ConflictError("Archived courses cannot be published.");
      }
      if (publish && current.category.status !== "PUBLISHED") {
        throw new ConflictError(
          "Publish the parent category before publishing this course.",
        );
      }
      assertCourseConfiguration(current, {}, { publishing: publish });
      return transaction.course.update({
        where: { id },
        data: { status: publish ? "PUBLISHED" : "DRAFT" },
        include: courseInclude,
      });
    });
  } catch (error) {
    if (
      error instanceof ConflictError ||
      error instanceof NotFoundError ||
      error instanceof ValidationError
    ) {
      throw error;
    }
    throw handlePrismaError(error);
  }
}

export async function restore(id) {
  try {
    return await prisma.$transaction(async (transaction) => {
      await acquireTransactionLock(transaction, `curriculum:${id}`);
      const current = await transaction.course.findUnique({
        where: { id },
        include: courseInclude,
      });
      if (!current) throw new NotFoundError("Course not found.");
      if (current.status !== "ARCHIVED") {
        throw new ConflictError("Only archived courses can be restored.");
      }
      if (current.category.status === "ARCHIVED") {
        throw new ConflictError("Restore the parent category before this course.");
      }
      return transaction.course.update({
        where: { id },
        data: { status: "DRAFT" },
        include: courseInclude,
      });
    });
  } catch (error) {
    if (error instanceof ConflictError || error instanceof NotFoundError) throw error;
    throw handlePrismaError(error);
  }
}

export async function findDeletionImpact(id) {
  const course = await prisma.course.findUnique({
    where: { id },
    select: { id: true, status: true },
  });
  if (!course) return null;
  return buildDeletionImpact(prisma, {
    resourceType: "COURSE",
    resourceId: course.id,
    resourceStatus: course.status,
    courseIds: [course.id],
  });
}

export async function removePermanently(id) {
  try {
    return await runSerializableCatalogTransaction(prisma, async (transaction) => {
      await lockArchivedCourses(transaction, [id]);
      const impact = await buildDeletionImpact(transaction, {
        resourceType: "COURSE",
        resourceId: id,
        resourceStatus: "ARCHIVED",
        courseIds: [id],
        sequential: true,
      });
      assertDeletionAllowed(impact);
      const result = await deleteCourseGraph(transaction, id);
      return { id, ...result };
    });
  } catch (error) {
    if (error instanceof ConflictError || error?.code === "CATALOG_DELETION_BLOCKED") {
      throw error;
    }
    throw handlePrismaError(error);
  }
}
