import * as categoryService from "../../../services/v1/catalog/category.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function getCategoriesAdmin(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await categoryService.getCategoriesAdminService(req.query),
      "Categories fetched successfully",
    );
  } catch (error) { next(error); }
}

export async function getCategoryAdmin(req, res, next) {
  try {
    return ApiResponse.send(res, await categoryService.getCategoryAdminService(req.params.id));
  } catch (error) { next(error); }
}

export async function getCategoryDeletionImpact(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await categoryService.getCategoryDeletionImpactService(req.params.id),
      "Category deletion impact fetched successfully",
    );
  } catch (error) { next(error); }
}

export async function createCategory(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await categoryService.createCategoryService(req.body, req.user.id),
      "Category created successfully",
      201,
    );
  } catch (error) { next(error); }
}

export async function updateCategory(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await categoryService.updateCategoryService(req.params.id, req.body, req.user.id),
      "Category updated successfully",
    );
  } catch (error) { next(error); }
}

export async function publishCategory(req, res, next) {
  try {
    return ApiResponse.send(res, await categoryService.setCategoryPublicationService(req.params.id, true, req.user.id));
  } catch (error) { next(error); }
}

export async function unpublishCategory(req, res, next) {
  try {
    return ApiResponse.send(res, await categoryService.setCategoryPublicationService(req.params.id, false, req.user.id));
  } catch (error) { next(error); }
}

export async function archiveCategory(req, res, next) {
  try {
    return ApiResponse.send(res, await categoryService.archiveCategoryService(req.params.id, req.user.id));
  } catch (error) { next(error); }
}

export async function unarchiveCategory(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await categoryService.unarchiveCategoryService(req.params.id, req.user.id),
      "Category restored as a draft",
    );
  } catch (error) { next(error); }
}

export async function deleteCategoryPermanently(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await categoryService.deleteCategoryPermanentlyService(req.params.id, req.user.id),
      "Category permanently deleted",
    );
  } catch (error) { next(error); }
}
