import type { ApiConfig } from "./config.js";
import { AuthService } from "./modules/auth/auth-service.js";
import { nodePasswordHasher } from "./modules/auth/password.js";
import type { ApiServices } from "./modules/auth/routes.js";
import { generateOpaqueSecret } from "./modules/auth/secrets.js";
import { AuthorizationService } from "./modules/authorization/authorization-service.js";
import { UserService } from "./modules/users/user-service.js";
import { FileAuthStateStore } from "./storage/file-auth-state-store.js";

export interface RuntimeServices extends ApiServices {
  authorizationService: AuthorizationService;
}

export async function createRuntimeServices(
  config: ApiConfig
): Promise<RuntimeServices> {
  if (config.environment === "production") {
    throw new Error("Production authentication store is not configured");
  }

  const store = await FileAuthStateStore.open(config.authStorePath);
  const dummyPasswordHash = await nodePasswordHasher.hash(
    generateOpaqueSecret()
  );

  return {
    authService: new AuthService(store, dummyPasswordHash, {
      passwordHasher: nodePasswordHasher
    }),
    userService: new UserService(store, {
      passwordHasher: nodePasswordHasher
    }),
    authorizationService: new AuthorizationService(store)
  };
}
