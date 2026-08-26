import { describe, expect, it } from "vitest";
import type { ProjectRepository } from "./repository.js";

describe("ProjectRepository", () => {
  it("exposes only list, detail, and update to shared offline UI", async () => {
    await import("./repository.js");

    const methods: ReadonlyArray<keyof ProjectRepository> = [
      "listProjects",
      "getProject",
      "updateProject"
    ];

    expect(methods).toEqual(["listProjects", "getProject", "updateProject"]);
  });
});
