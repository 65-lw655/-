import type {
  ProjectInput,
  ProjectListFilters,
  ProjectPermissions,
  ProjectRecord
} from "@project-online/domain";

export type ProjectRepositoryErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "PROJECT_FORBIDDEN"
  | "PROJECT_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "UNAVAILABLE";

export class ProjectRepositoryError extends Error {
  readonly code: ProjectRepositoryErrorCode;
  readonly fieldErrors: Readonly<Record<string, string>> | undefined;

  constructor(
    code: ProjectRepositoryErrorCode,
    message: string,
    options?: {
      fieldErrors?: Readonly<Record<string, string>>;
      cause?: unknown;
    }
  ) {
    super(message, { cause: options?.cause });
    this.name = "ProjectRepositoryError";
    this.code = code;
    this.fieldErrors = options?.fieldErrors;
  }
}

export interface ProjectListItem {
  project: ProjectRecord;
  ownerLabels: string[];
  syncState?: "SYNCED" | "PENDING";
}

export interface ProjectPage {
  items: ProjectListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProjectDetails {
  project: ProjectRecord;
  permissions: ProjectPermissions;
  syncState?: "SYNCED" | "PENDING";
}

export interface ProjectRepository {
  listProjects(filters: ProjectListFilters): Promise<ProjectPage>;
  getProject(projectId: string): Promise<ProjectDetails>;
  updateProject(
    projectId: string,
    input: ProjectInput
  ): Promise<ProjectDetails>;
}
