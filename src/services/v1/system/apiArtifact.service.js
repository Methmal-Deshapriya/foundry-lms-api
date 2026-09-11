import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const serviceDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(serviceDirectory, "../../../..");
const collectionPath = path.join(
  repositoryRoot,
  "postman",
  "foundry-lms.postman_collection.json",
);
const environmentPath = path.join(
  repositoryRoot,
  "postman",
  "foundry-lms.local.postman_environment.json",
);

async function readArtifact(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function setCollectionBaseUrl(collection, baseUrl) {
  const variable = collection.variable?.find(({ key }) => key === "baseUrl");
  if (variable) variable.value = baseUrl;
  return collection;
}

function setEnvironmentBaseUrl(environment, baseUrl) {
  const variable = environment.values?.find(({ key }) => key === "baseUrl");
  if (variable) variable.value = baseUrl;
  return environment;
}

export async function getPostmanCollectionService(baseUrl) {
  return setCollectionBaseUrl(await readArtifact(collectionPath), baseUrl);
}

export async function getPostmanEnvironmentService(baseUrl) {
  return setEnvironmentBaseUrl(await readArtifact(environmentPath), baseUrl);
}
