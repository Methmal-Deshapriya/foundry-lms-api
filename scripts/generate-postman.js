import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const specificationPath = path.join(repositoryRoot, "docs", "api", "openapi.yaml");
const postmanDirectory = path.join(repositoryRoot, "postman");
const collectionPath = path.join(
  postmanDirectory,
  "foundry-lms.postman_collection.json",
);
const environmentPath = path.join(
  postmanDirectory,
  "foundry-lms.local.postman_environment.json",
);
const checkOnly = process.argv.includes("--check");
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const ACCESS_LABELS = Object.freeze({
  PUBLIC: "PUBLIC",
  AUTHENTICATED: "SIGNED IN",
  STUDENT: "STUDENT",
  ADMIN: "ADMIN + SUPER ADMIN",
  SUPER_ADMIN: "SUPER ADMIN ONLY",
});

const captureScripts = new Map([
  ["registerStudent", [["registeredUserId", "id"]]],
  ["verifyEmailOtp", [["currentUserId", "id"]]],
  ["login", [["currentUserId", "id"]]],
  ["createCategory", [["categoryId", "id"], ["categorySlug", "slug"]]],
  ["createCourse", [["courseId", "id"], ["courseSlug", "slug"]]],
  ["createIntake", [["intakeId", "id"]]],
  ["createSession", [["sessionId", "id"]]],
  ["attachCourseSession", [["courseSessionId", "courseSession.id"]]],
  ["listCourseEligibleStudents", [["eligibleStudentsCursor", "pagination.nextCursor"]]],
  ["selfEnrollFreeCourse", [["enrollmentId", "id"]]],
  ["manuallyEnrollStudent", [["enrollmentId", "id"]]],
  ["createEnrollmentRequest", [["enrollmentRequestId", "id"]]],
  ["issueCertificate", [["certificateId", "id"], ["certificateCode", "certificateCode"]]],
  ["submitProject", [["projectId", "id"]]],
]);

const environmentVariables = [
  ["baseUrl", "http://localhost:5000"],
  ["loginEmail", ""],
  ["loginPassword", ""],
  ["registrationEmail", ""],
  ["registrationPassword", ""],
  ["otpCode", ""],
  ["resetToken", ""],
  ["currentUserId", ""],
  ["registeredUserId", ""],
  ["targetUserId", ""],
  ["serviceSlug", "bootcamps"],
  ["categoryId", ""],
  ["categorySlug", ""],
  ["courseId", ""],
  ["courseSlug", ""],
  ["intakeId", ""],
  ["sessionId", ""],
  ["courseSessionId", ""],
  ["eligibleStudentsCursor", ""],
  ["enrollmentId", ""],
  ["enrollmentRequestId", ""],
  ["certificateId", ""],
  ["certificateCode", ""],
  ["projectId", ""],
  ["allowDestructiveRequests", "false"],
];

function resolveLocalReference(contract, value) {
  if (!value?.$ref) return value;
  if (!value.$ref.startsWith("#/")) {
    throw new Error(`Only local OpenAPI references are supported: ${value.$ref}`);
  }
  return value.$ref
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((current, part) => current?.[part], contract);
}

function parameterExample(contract, parameter) {
  const schema = resolveLocalReference(contract, parameter.schema) ?? {};
  return parameter.example ?? schema.example ?? schema.default ?? "";
}

function createUrl(contract, routePath, parameters = []) {
  const postmanPath = routePath.replaceAll(
    /\{([^}]+)\}/g,
    (_, name) => `{{${name}}}`,
  );
  const query = parameters
    .map((parameter) => resolveLocalReference(contract, parameter))
    .filter((parameter) => parameter?.in === "query")
    .map((parameter) => ({
      key: parameter.name,
      value: String(parameterExample(contract, parameter)),
      description: parameter.description ?? "",
      disabled: !parameter.required,
    }));

  return {
    raw: `{{baseUrl}}${postmanPath}`,
    host: ["{{baseUrl}}"],
    path: postmanPath.split("/").filter(Boolean),
    ...(query.length ? { query } : {}),
  };
}

function createBody(contract, requestBody) {
  if (!requestBody) return undefined;
  const resolvedBody = resolveLocalReference(contract, requestBody);
  const media = resolvedBody?.content?.["application/json"];
  if (!media) return undefined;
  if (media.example === undefined) {
    throw new Error("Every JSON request body must define an explicit example.");
  }
  return {
    mode: "raw",
    raw: JSON.stringify(media.example, null, 2),
    options: { raw: { language: "json" } },
  };
}

function createRequestItem(contract, method, routePath, operation) {
  const accessLabel = ACCESS_LABELS[operation["x-access"]];
  if (!accessLabel) {
    throw new Error(`${operation.operationId} has an invalid x-access value.`);
  }
  const body = createBody(contract, operation.requestBody);
  const headers = [{ key: "Accept", value: "application/json" }];
  if (body) headers.unshift({ key: "Content-Type", value: "application/json" });

  return {
    _foundryOperationId: operation.operationId,
    name: `[${accessLabel}] ${operation.summary}`,
    request: {
      method: method.toUpperCase(),
      header: headers,
      ...(body ? { body } : {}),
      url: createUrl(contract, routePath, operation.parameters),
      description: [
        `Access: ${accessLabel}`,
        operation.description,
        `Operation ID: ${operation.operationId}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  };
}

function decorateRequests(items) {
  for (const item of items ?? []) {
    if (item.item) {
      decorateRequests(item.item);
      continue;
    }

    if (item.name.includes("[DESTRUCTIVE]")) {
      item.event = [
        {
          listen: "prerequest",
          script: {
            type: "text/javascript",
            exec: [
              'if (pm.environment.get("allowDestructiveRequests") !== "true") {',
              '  throw new Error("Destructive requests are blocked. Set allowDestructiveRequests=true in the selected environment only for an intentional test.");',
              "}",
            ],
          },
        },
      ];
    }

    const captures = captureScripts.get(item._foundryOperationId);
    delete item._foundryOperationId;
    if (!captures) continue;

    const lines = [
      "if (pm.response.code >= 200 && pm.response.code < 300) {",
      "  const data = pm.response.json()?.data;",
    ];
    for (const [variable, property] of captures) {
      const optionalProperty = property.split(".").join("?.");
      if (variable === "eligibleStudentsCursor") {
        lines.push(
          `  pm.environment.set("${variable}", data?.${optionalProperty} ?? "");`,
        );
        continue;
      }
      lines.push(
        `  if (data?.${optionalProperty}) pm.environment.set("${variable}", data.${property});`,
      );
    }
    lines.push("}");

    item.event = [
      ...(item.event ?? []),
      {
        listen: "test",
        script: { type: "text/javascript", exec: lines },
      },
    ];
  }
}

function createCollection(contract) {
  const folders = (contract.tags ?? []).map(({ name, description }) => ({
    name,
    ...(description ? { description } : {}),
    item: [],
  }));
  const foldersByName = new Map(folders.map((folder) => [folder.name, folder]));

  for (const [routePath, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      const tag = operation.tags?.[0];
      const folder = foldersByName.get(tag);
      if (!folder) throw new Error(`${operation.operationId} has no valid folder tag.`);
      folder.item.push(createRequestItem(contract, method, routePath, operation));
    }
  }

  const baseUrl = contract.servers?.[0]?.variables?.baseUrl?.default
    ?? "http://localhost:5000";
  const collection = {
    info: {
      name: contract.info.title,
      description: [
        contract.info.description?.trim(),
        "GENERATED FILE: edit docs/api/openapi.yaml, then run npm run api:postman.",
        "Authentication uses the Postman cookie jar. Login or OTP verification first; never paste the HTTP-only JWT into collection variables.",
        "Access labels: [PUBLIC] no login; [SIGNED IN] any authenticated account subject to ownership; [STUDENT] learner operation; [ADMIN + SUPER ADMIN] both administrative roles; [SUPER ADMIN ONLY] regular admins are rejected.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    variable: [{ key: "baseUrl", value: baseUrl, type: "string" }],
    item: folders,
  };
  decorateRequests(collection.item);
  return collection;
}

function createEnvironment() {
  return {
    name: "Foundry LMS - Local",
    values: environmentVariables.map(([key, value]) => ({
      key,
      value,
      type: "default",
      enabled: true,
    })),
    _postman_variable_scope: "environment",
    _postman_exported_using: "Foundry LMS API artifact generator",
  };
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function assertCurrent(filePath, expectedContent) {
  let currentContent;
  try {
    currentContent = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`${path.relative(repositoryRoot, filePath)} is missing.`);
    }
    throw error;
  }
  if (currentContent.replaceAll("\r\n", "\n") !== expectedContent) {
    throw new Error(
      `${path.relative(repositoryRoot, filePath)} is stale. Run npm run api:postman.`,
    );
  }
}

async function main() {
  const contract = YAML.parse(await fs.readFile(specificationPath, "utf8"));
  const collectionContent = stableJson(createCollection(contract));
  const environmentContent = stableJson(createEnvironment());

  if (checkOnly) {
    await Promise.all([
      assertCurrent(collectionPath, collectionContent),
      assertCurrent(environmentPath, environmentContent),
    ]);
    console.log("Postman collection and environment are current.");
    return;
  }

  await fs.mkdir(postmanDirectory, { recursive: true });
  await Promise.all([
    fs.writeFile(collectionPath, collectionContent),
    fs.writeFile(environmentPath, environmentContent),
  ]);
  console.log(`Generated ${path.relative(repositoryRoot, collectionPath)}`);
  console.log(`Generated ${path.relative(repositoryRoot, environmentPath)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
