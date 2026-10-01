import { Prisma } from "@prisma/client";

/**
 * Check a Prisma `include` / `select` against the real generated data model,
 * for tests that mock the client (code review M10-01): a mocked query never
 * notices a removed relation, so the user-detail page shipped broken.
 * Returns the list of problems (empty when the shape is valid).
 */
export function queryShapeProblems(modelName, args, path = modelName) {
  const model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === modelName);
  if (!model) return [`${path}: unknown model ${modelName}`];
  const problems = [];
  for (const key of ["include", "select"]) {
    const shape = args?.[key];
    if (!shape || typeof shape !== "object") continue;
    for (const [field, value] of Object.entries(shape)) {
      if (field === "_count") continue;
      const definition = model.fields.find((entry) => entry.name === field);
      if (!definition) {
        problems.push(`${path}.${field}: no such field on ${modelName}`);
        continue;
      }
      if (definition.kind === "object" && value && typeof value === "object") {
        problems.push(...queryShapeProblems(definition.type, value, `${path}.${field}`));
      }
      if (key === "include" && definition.kind !== "object") {
        problems.push(`${path}.${field}: only relations can be included`);
      }
    }
  }
  return problems;
}
