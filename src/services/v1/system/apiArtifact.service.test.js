import { describe, expect, it } from "vitest";
import {
  getPostmanCollectionService,
  getPostmanEnvironmentService,
} from "./apiArtifact.service.js";

describe("Postman API artifacts", () => {
  it("serves the generated collection with the importing server as baseUrl", async () => {
    const collection = await getPostmanCollectionService(
      "https://api.foundry.example",
    );
    expect(collection.info.schema).toContain("collection/v2.1.0");
    expect(collection.variable.find(({ key }) => key === "baseUrl")?.value)
      .toBe("https://api.foundry.example");
  });

  it("serves the safe environment with destructive operations disabled", async () => {
    const environment = await getPostmanEnvironmentService(
      "http://localhost:5000",
    );
    expect(environment.values.find(({ key }) => key === "baseUrl")?.value)
      .toBe("http://localhost:5000");
    expect(
      environment.values.find(
        ({ key }) => key === "allowDestructiveRequests",
      )?.value,
    ).toBe("false");
  });
});
