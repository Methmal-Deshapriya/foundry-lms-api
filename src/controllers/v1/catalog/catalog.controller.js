import * as catalogService from "../../../services/v1/catalog/catalog.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

const setPublicCache = (res) => {
  res.set("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
};

export async function getPublicCategories(req, res, next) {
  try {
    const data = await catalogService.getPublicCategoriesService(req.params.serviceSlug);
    setPublicCache(res);
    return ApiResponse.send(res, data, "Categories fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getPublicCategory(req, res, next) {
  try {
    const data = await catalogService.getPublicCategoryService(
      req.params.serviceSlug,
      req.params.categorySlug,
    );
    setPublicCache(res);
    return ApiResponse.send(res, data, "Category fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function getPublicCourse(req, res, next) {
  try {
    const data = await catalogService.getPublicCourseService(
      req.params.serviceSlug,
      req.params.categorySlug,
      req.params.courseSlug,
    );
    setPublicCache(res);
    return ApiResponse.send(res, data, "Course fetched successfully");
  } catch (error) {
    next(error);
  }
}
