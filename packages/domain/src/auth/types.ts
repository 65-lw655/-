export type SystemRole = "USER" | "LEADER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "DISABLED";
export type CredentialStatus =
  "PENDING_ACTIVATION" | "READY" | "RESET_REQUIRED";
export type ProjectMemberRole = "OWNER" | "EDITOR" | "VIEWER";

export type AuthorizationAction =
  | "PROJECT_LIST"
  | "PROJECT_READ"
  | "PROJECT_CREATE"
  | "BUSINESS_CREATE"
  | "BUSINESS_UPDATE"
  | "BUSINESS_DELETE"
  | "MEMBER_MANAGE"
  | "REMOVE_LAST_OWNER"
  | "PROJECT_ARCHIVE"
  | "PROJECT_RESTORE"
  | "PROJECT_EXPORT"
  | "FILE_DOWNLOAD"
  | "AUDIT_READ"
  | "AUDIT_MUTATE"
  | "USER_MANAGE"
  | "SYNC_WRITE";

export interface AuthorizationContext {
  accountStatus: AccountStatus;
  credentialStatus: CredentialStatus;
  sessionValid: boolean;
  systemRole: SystemRole;
  projectExists: boolean;
  memberRole: ProjectMemberRole | null;
}

export type AuthorizationDecision =
  | { allowed: true; auditRequired: boolean }
  | {
      allowed: false;
      reason:
        | "ACCOUNT_DISABLED"
        | "CREDENTIAL_NOT_READY"
        | "SESSION_INVALID"
        | "PROJECT_NOT_FOUND"
        | "FORBIDDEN";
    };
