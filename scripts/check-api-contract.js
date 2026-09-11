import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const appPath = path.join(repositoryRoot, "src", "app.js");
const specificationPath = path.join(repositoryRoot, "docs", "api", "openapi.yaml");
const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const ACCESS_LEVELS = new Set([
  "PUBLIC",
  "AUTHENTICATED",
  "STUDENT",
  "ADMIN",
  "SUPER_ADMIN",
]);

function joinUrl(prefix, child) {
  const combined = `${prefix}/${child}`.replaceAll(/\/{2,}/g, "/");
  return combined.length > 1 ? combined.replace(/\/$/, "") : combined;
}

function normalizeRoute(method, routePath) {
  const structuralPath = routePath
    .replace(/:([A-Za-z0-9_]+)/g, "{}")
    .replace(/\{[^}]+\}/g, "{}")
    .replaceAll(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  return `${method.toUpperCase()} ${structuralPath || "/"}`;
}

function readImports(source, filePath) {
  const imports = new Map();
  const pattern = /import\s+([A-Za-z_$][\w$]*)\s+from\s+["']([^"']+)["'];/g;
  for (const match of source.matchAll(pattern)) {
    if (!match[2].startsWith(".")) continue;
    imports.set(match[1], path.resolve(path.dirname(filePath), match[2]));
  }
  return imports;
}

async function collectRouterRoutes(filePath, prefix, visited = new Set()) {
  const visitKey = `${filePath}:${prefix}`;
  if (visited.has(visitKey)) return [];
  visited.add(visitKey);

  const source = await fs.readFile(filePath, "utf8");
  const imports = readImports(source, filePath);
  const routes = [];
  const routePattern = /router\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;

  for (const match of source.matchAll(routePattern)) {
    routes.push({ method: match[1], path: joinUrl(prefix, match[2]) });
  }

  const nestedPattern = /router\.use\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;
  for (const match of source.matchAll(nestedPattern)) {
    const nestedFile = imports.get(match[2]);
    if (!nestedFile) {
      throw new Error(`Cannot resolve nested router ${match[2]} in ${filePath}.`);
    }
    routes.push(
      ...(await collectRouterRoutes(
        nestedFile,
        joinUrl(prefix, match[1]),
        visited,
      )),
    );
  }

  return routes;
}

async function collectExpressRoutes() {
  const source = await fs.readFile(appPath, "utf8");
  const imports = readImports(source, appPath);
  const routes = [];
  const mountPattern = /app\.use\(\s*["']([^"']+)["']\s*,\s*([A-Za-z_$][\w$]*)\s*\)/g;

  for (const match of source.matchAll(mountPattern)) {
    const routerFile = imports.get(match[2]);
    if (!routerFile) continue;
    routes.push(...(await collectRouterRoutes(routerFile, match[1])));
  }

  const directPattern = /app\.(get|post|put|patch|delete)\(\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(directPattern)) {
    routes.push({ method: match[1], path: match[2] });
  }

  return routes;
}

async function readContract() {
  const source = await fs.readFile(specificationPath, "utf8");
  const contract = YAML.parse(source);
  const routes = [];
  const operationIds = new Set();
  const declaredTags = new Set((contract.tags ?? []).map(({ name }) => name));

  for (const [routePath, pathItem] of Object.entries(contract.paths ?? {})) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(method)) continue;
      routes.push({ method, path: routePath });
      if (!operation.operationId) {
        throw new Error(`${method.toUpperCase()} ${routePath} has no operationId.`);
      }
      if (operationIds.has(operation.operationId)) {
        throw new Error(`Duplicate operationId: ${operation.operationId}`);
      }
      operationIds.add(operation.operationId);
      if (!operation.summary) {
        throw new Error(`${method.toUpperCase()} ${routePath} has no summary.`);
      }
      const access = operation["x-access"];
      if (!ACCESS_LEVELS.has(access)) {
        throw new Error(
          `${operation.operationId} must declare a valid x-access level.`,
        );
      }
      const explicitlyPublic = Array.isArray(operation.security)
        && operation.security.length === 0;
      if (access === "PUBLIC" && !explicitlyPublic) {
        throw new Error(`${operation.operationId} is PUBLIC but still requires auth.`);
      }
      if (access !== "PUBLIC" && explicitlyPublic) {
        throw new Error(`${operation.operationId} is protected but disables auth.`);
      }
      for (const tag of operation.tags ?? []) {
        if (!declaredTags.has(tag)) {
          throw new Error(`${operation.operationId} uses undeclared tag ${tag}.`);
        }
      }
    }
  }

  return routes;
}

function difference(left, right) {
  return [...left].filter((value) => !right.has(value)).sort();
}

async function main() {
  const [expressRoutes, contractRoutes] = await Promise.all([
    collectExpressRoutes(),
    readContract(),
  ]);
  const expressSet = new Set(
    expressRoutes.map(({ method, path: routePath }) =>
      normalizeRoute(method, routePath),
    ),
  );
  const contractSet = new Set(
    contractRoutes.map(({ method, path: routePath }) =>
      normalizeRoute(method, routePath),
    ),
  );
  const missing = difference(expressSet, contractSet);
  const extra = difference(contractSet, expressSet);

  if (missing.length || extra.length) {
    if (missing.length) {
      console.error("Express routes missing from OpenAPI:");
      missing.forEach((route) => console.error(`  ${route}`));
    }
    if (extra.length) {
      console.error("OpenAPI operations missing from Express:");
      extra.forEach((route) => console.error(`  ${route}`));
    }
    process.exitCode = 1;
    return;
  }

  console.log(
    `OpenAPI contract covers all ${expressSet.size} Express operations.`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
