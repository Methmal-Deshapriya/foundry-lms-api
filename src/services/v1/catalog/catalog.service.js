import * as categoryRepo from "../../../repositories/v1/catalog/category.repository.js";
import * as courseRepo from "../../../repositories/v1/catalog/course.repository.js";
import {
  toPublicCategory,
  toPublicCourseCard,
  toPublicCourseDetail,
} from "../../../models/v1/catalog/catalog.model.js";
import { SERVICE_SLUG_TO_TYPE } from "../../../constants/v1/catalog/catalog.constants.js";
import { NotFoundError } from "../../../utils/Errors.js";

function resolveServiceType(serviceSlug) {
  const serviceType = SERVICE_SLUG_TO_TYPE[serviceSlug];
  if (!serviceType) {
    throw new NotFoundError("Learning service not found.");
  }
  return serviceType;
}

export async function getPublicCategoriesService(serviceSlug) {
  const serviceType = resolveServiceType(serviceSlug);
  const categories = await categoryRepo.findPublicByService(serviceType);
  return {
    serviceType,
    serviceSlug,
    categoryCount: categories.length,
    categories: categories.map(toPublicCategory),
  };
}

export async function getPublicCategoryService(serviceSlug, categorySlug) {
  const serviceType = resolveServiceType(serviceSlug);
  const category = await categoryRepo.findPublicBySlug(serviceType, categorySlug);
  if (!category) {
    throw new NotFoundError("Category not found.");
  }

  return {
    ...toPublicCategory(category),
    courses: category.courses.map(toPublicCourseCard),
  };
}

export async function getPublicCourseService(
  serviceSlug,
  categorySlug,
  courseSlug,
) {
  const serviceType = resolveServiceType(serviceSlug);
  const course = await courseRepo.findPublicDetail(
    serviceType,
    categorySlug,
    courseSlug,
  );
  if (!course) {
    throw new NotFoundError("Course not found.");
  }
  return toPublicCourseDetail(course);
}
