import { getAdminLearningServiceSummariesService } from "../../../services/v1/catalog/learningServiceSummary.service.js";
import { ApiResponse } from "../../../utils/responseHandler.js";

export async function getAdminLearningServiceSummaries(req, res, next) {
  try {
    return ApiResponse.send(
      res,
      await getAdminLearningServiceSummariesService(),
      "Learning service summaries fetched successfully",
    );
  } catch (error) {
    next(error);
  }
}
