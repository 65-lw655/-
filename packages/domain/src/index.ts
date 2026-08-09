export const SYSTEM_VERSION = "0.1.0" as const;

export { authorizeAction } from "./auth/authorization.js";
export type {
  AccountStatus,
  AuthorizationAction,
  AuthorizationContext,
  AuthorizationDecision,
  CredentialStatus,
  ProjectMemberRole,
  SystemRole
} from "./auth/types.js";
