import * as profileService from "../../../services/v1/profiles/profile.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

/**
 * Public Student Profile Controller
 */

export async function publishMyProfile(req, res, next) {
  try {
    return ApiResponse.send(res, await profileService.setProfilePublishedService(req.user, true), "Your public profile is visible again.");
  } catch (error) {
    next(error);
  }
}

export async function unpublishMyProfile(req, res, next) {
  try {
    return ApiResponse.send(res, await profileService.setProfilePublishedService(req.user, false), "Your public profile is now hidden.");
  } catch (error) {
    next(error);
  }
}

export async function getMyProfile(req, res, next) {
  try {
    const result = await profileService.getMyProfileService(req.user.id);
    return ApiResponse.send(res, result, "Profile fetched successfully");
  } catch (error) {
    next(error);
  }
}

export async function saveMyProfile(req, res, next) {
  try {
    const result = await profileService.saveMyProfileService(req.user, req.body);
    return ApiResponse.send(res, result, "Profile saved successfully");
  } catch (error) {
    next(error);
  }
}

export async function getPublicProfile(req, res, next) {
  try {
    const profile = await profileService.getPublicProfileService(req.params.slug);
    return ApiResponse.send(res, profile, "Profile fetched successfully");
  } catch (error) {
    next(error);
  }
}
