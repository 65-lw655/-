import type {
  AccountStatus,
  CredentialStatus,
  SystemRole
} from "@project-online/domain";

import type { StoredUser } from "../../storage/auth-state.js";

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  role: SystemRole;
  accountStatus: AccountStatus;
  credentialStatus: CredentialStatus;
  createdAt: string;
  updatedAt: string;
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    accountStatus: user.accountStatus,
    credentialStatus: user.credentialStatus,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}
