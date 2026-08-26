import { invoke } from "@tauri-apps/api/core";

import type { CredentialStatus, Invoke } from "./desktop-bridge.js";

export type { CredentialStatus };

export interface CredentialStore {
  status(): Promise<CredentialStatus>;
  save(credential: string): Promise<CredentialStatus>;
  delete(): Promise<CredentialStatus>;
}

export function createCredentialStore(
  invokeCommand: Invoke = invoke
): CredentialStore {
  return {
    status: () => invokeCommand<CredentialStatus>("credential_status"),
    save: (credential) =>
      invokeCommand<CredentialStatus>("save_credential", {
        input: { credential }
      }),
    delete: () => invokeCommand<CredentialStatus>("delete_credential")
  };
}

export const credentialStore = createCredentialStore();
