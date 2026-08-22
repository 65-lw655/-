export type ProjectServiceErrorCode =
  | "PROJECT_NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "INVALID_PROJECT_STATE"
  | "USER_NOT_AVAILABLE"
  | "MEMBER_NOT_FOUND"
  | "MEMBER_ALREADY_EXISTS"
  | "LAST_OWNER_REQUIRED";

export class ProjectServiceError extends Error {
  constructor(
    readonly code: ProjectServiceErrorCode,
    message: string
  ) {
    super(message);
    this.name = "ProjectServiceError";
  }
}
