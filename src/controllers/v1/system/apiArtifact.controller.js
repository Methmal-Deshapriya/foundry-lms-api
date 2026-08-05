import * as apiArtifactService from "../../../services/v1/system/apiArtifact.service.js";

function getRequestBaseUrl(req) {
  const configuredUrl = process.env.PUBLIC_API_URL?.trim().replace(/\/$/, "");
  if (configuredUrl) return configuredUrl;
  return `${req.protocol}://${req.get("host")}`;
}

function sendArtifact(res, artifact, filename) {
  res.set({
    "Cache-Control": "no-store",
    "Content-Disposition": `inline; filename="${filename}"`,
    "Content-Type": "application/json; charset=utf-8",
  });
  return res.status(200).send(JSON.stringify(artifact, null, 2));
}

export async function getPostmanCollection(req, res, next) {
  try {
    const collection = await apiArtifactService.getPostmanCollectionService(
      getRequestBaseUrl(req),
    );
    return sendArtifact(
      res,
      collection,
      "foundry-lms.postman_collection.json",
    );
  } catch (error) {
    next(error);
  }
}

export async function getPostmanEnvironment(req, res, next) {
  try {
    const environment = await apiArtifactService.getPostmanEnvironmentService(
      getRequestBaseUrl(req),
    );
    return sendArtifact(
      res,
      environment,
      "foundry-lms.local.postman_environment.json",
    );
  } catch (error) {
    next(error);
  }
}
