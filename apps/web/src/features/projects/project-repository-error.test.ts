import {
  validateProjectInput,
  type ProjectInput
} from "@project-online/domain";
import { ProjectRepositoryError } from "@project-online/ui";
import { describe, expect, it } from "vitest";

import { ApiClientError } from "../../api-client.js";
import { toProjectUpdateRepositoryError } from "./project-repository-error.js";

describe("project-repository-error", () => {
  it("maps API validation errors to shared validation failures with field errors", () => {
    const invalidInput: ProjectInput = {
      name: " ",
      year: 1800,
      type: "展览展示",
      status: "施工中",
      phase: "深化设计",
      filingStatus: "待归档",
      plannedCompletionDate: null,
      actualCompletionDate: null
    };

    const mapped = toProjectUpdateRepositoryError(
      new ApiClientError(400, "VALIDATION_ERROR", "Project input is invalid"),
      invalidInput
    );

    const validation = validateProjectInput(invalidInput);
    expect(validation.ok).toBe(false);
    expect(mapped).toBeInstanceOf(ProjectRepositoryError);
    expect(mapped).toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: validation.ok ? undefined : validation.fields
    });
  });
});
