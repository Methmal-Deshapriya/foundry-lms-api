import * as categoryRepo from "../../../repositories/v1/catalog/category.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import {
  toPublicCategory,
  toPublicCourseCard,
  toPublicCourseDetail,
  toPublicExploreCourseCard,
} from "../../../models/v1/catalog/catalog.model.js";
import { publicExploreFiltersSchema } from "../../../constants/v1/catalog/course.schema.js";
import { NotFoundError, ValidationError } from "../../../utils/Errors.js";
import * as learningServiceRepository from "../../../repositories/v1/catalog/learningService.repository.js";

function parse(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ValidationError(issue.message, issue.path[0]);
  }
  return result.data;
}

async function resolveService(serviceSlug) {
  const service = await learningServiceRepository.findBySlug(serviceSlug, { activeOnly: true });
  if (!service) throw new NotFoundError("Learning service not found.");
  return service;
}

export async function getPublicCategoriesService(serviceSlug) {
  const service = await resolveService(serviceSlug);
  const categories = await categoryRepo.findPublicByService(service.id);
  return {
    serviceId: service.id,
    serviceType: service.key,
    serviceSlug: service.slug,
    categoryCount: categories.length,
    categories: categories.map(toPublicCategory),
  };
}

export async function getPublicCategoryService(serviceSlug, categorySlug) {
  const service = await resolveService(serviceSlug);
  const category = await categoryRepo.findPublicBySlug(service.id, categorySlug);
  if (!category) {
    throw new NotFoundError("Category not found.");
  }

  return {
    ...toPublicCategory(category),
    courses: category.courses.map(toPublicCourseCard),
  };
}

export async function getPublicExploreService(query = {}) {
  const filters = parse(publicExploreFiltersSchema, query);
  const { limit, offset, ...rest } = filters;
  const { total, courses } = await courseRepo.findPublicExplore(rest, limit, offset);
  return {
    courses: courses.map(toPublicExploreCourseCard),
    pagination: {
      total,
      limit,
      offset,
      hasMore: offset + courses.length < total,
    },
  };
}

export async function getPublicCourseService(
  serviceSlug,
  categorySlug,
  courseSlug,
) {
  const service = await resolveService(serviceSlug);
  const course = await courseRepo.findPublicDetail(
    service.id,
    categorySlug,
    courseSlug,
  );
  if (!course) {
    throw new NotFoundError("Course not found.");
  }
  return toPublicCourseDetail(course);
}
