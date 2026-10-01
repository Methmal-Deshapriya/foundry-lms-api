import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../utils/prisma.js", () => ({ default: {} }));
import { UNREFERENCED_RELATIONS } from "./storedObject.repository.js";

// The nightly cleanup deletes any stored object none of these relations
// point at. If a new model gets a StoredObject relation and this list isn't
// updated, its files would be deleted the next night (code review M04-11).
// This reads the schema itself, so the check can't drift.
describe("storage cleanup reference filter", () => {
  it("covers every relation on the StoredObject model", () => {
    const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../prisma/schema.prisma");
    const schema = fs.readFileSync(schemaPath, "utf8");
    const models = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((match) => match[1]));
    const block = schema.match(/^model StoredObject \{([\s\S]*?)^\}/m)[1];
    const relations = block
      .split("\n")
      .map((line) => line.trim().split(/\s+/))
      .filter(([field, type]) => field && type && models.has(type.replace(/[[\]?]/g, "")))
      .map(([field]) => field)
      .filter((field) => field !== "uploadedBy");

    expect(relations.length).toBeGreaterThan(10);
    expect([...UNREFERENCED_RELATIONS].sort()).toEqual(relations.sort());
  });
});
