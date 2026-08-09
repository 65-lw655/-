import type {
  AuthorizationAction,
  AuthorizationContext,
  AuthorizationDecision
} from "./types.js";

const businessWriteActions = new Set<AuthorizationAction>([
  "BUSINESS_CREATE",
  "BUSINESS_UPDATE",
  "BUSINESS_DELETE",
  "SYNC_WRITE"
]);

const ownerOrEditor = (context: AuthorizationContext): boolean =>
  context.memberRole === "OWNER" || context.memberRole === "EDITOR";

const hasProjectReadAccess = (context: AuthorizationContext): boolean =>
  context.systemRole !== "USER" || context.memberRole !== null;

const allowed = (auditRequired = false): AuthorizationDecision => ({
  allowed: true,
  auditRequired
});

const forbidden = (): AuthorizationDecision => ({
  allowed: false,
  reason: "FORBIDDEN"
});

export const authorizeAction = (
  context: AuthorizationContext,
  action: AuthorizationAction
): AuthorizationDecision => {
  if (context.accountStatus !== "ACTIVE") {
    return { allowed: false, reason: "ACCOUNT_DISABLED" };
  }

  if (context.credentialStatus !== "READY") {
    return { allowed: false, reason: "CREDENTIAL_NOT_READY" };
  }

  if (!context.sessionValid) {
    return { allowed: false, reason: "SESSION_INVALID" };
  }

  if (action === "PROJECT_CREATE" || action === "USER_MANAGE") {
    return context.systemRole === "ADMIN" ? allowed() : forbidden();
  }

  if (!context.projectExists) {
    return { allowed: false, reason: "PROJECT_NOT_FOUND" };
  }

  if (action === "AUDIT_MUTATE" || action === "REMOVE_LAST_OWNER") {
    return forbidden();
  }

  if (action === "PROJECT_LIST" || action === "PROJECT_READ") {
    return hasProjectReadAccess(context) ? allowed() : forbidden();
  }

  if (businessWriteActions.has(action)) {
    if (context.systemRole === "ADMIN") {
      return allowed(context.memberRole === null);
    }

    return ownerOrEditor(context) ? allowed() : forbidden();
  }

  if (
    action === "MEMBER_MANAGE" ||
    action === "PROJECT_ARCHIVE" ||
    action === "PROJECT_RESTORE"
  ) {
    if (context.systemRole === "ADMIN") {
      return allowed(context.memberRole === null);
    }

    return context.memberRole === "OWNER" ? allowed() : forbidden();
  }

  if (action === "PROJECT_EXPORT") {
    return context.memberRole === "OWNER" ? allowed(true) : forbidden();
  }

  if (action === "FILE_DOWNLOAD") {
    return hasProjectReadAccess(context) ? allowed(true) : forbidden();
  }

  if (action === "AUDIT_READ") {
    return context.systemRole !== "USER" || context.memberRole === "OWNER"
      ? allowed()
      : forbidden();
  }

  return forbidden();
};
