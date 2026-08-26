import type { ApiConfig } from "./config.js";
import { createDatabasePool } from "./database/pool.js";
import { AuthService } from "./modules/auth/auth-service.js";
import { nodePasswordHasher } from "./modules/auth/password.js";
import type { ApiServices } from "./modules/auth/routes.js";
import { generateOpaqueSecret } from "./modules/auth/secrets.js";
import { AuthorizationService } from "./modules/authorization/authorization-service.js";
import { MemberService } from "./modules/projects/member-service.js";
import { PostgresProjectRepository } from "./modules/projects/postgres-project-repository.js";
import { ProjectService } from "./modules/projects/project-service.js";
import { SyncService } from "./modules/sync/sync-service.js";
import { UserService } from "./modules/users/user-service.js";
import { FileAuthStateStore } from "./storage/file-auth-state-store.js";

export interface RuntimeServices extends ApiServices {
  authorizationService: AuthorizationService;
  close: () => Promise<void>;
}

export async function createRuntimeServices(
  config: ApiConfig
): Promise<RuntimeServices> {
  if (config.databaseUrl === undefined || config.databaseUrl.length === 0) {
    throw new Error("DATABASE_URL is required to create runtime services");
  }
  if (config.environment === "production") {
    throw new Error("Production authentication store is not configured");
  }

  const store = await FileAuthStateStore.open(config.authStorePath);
  const dummyPasswordHash = await nodePasswordHasher.hash(
    generateOpaqueSecret()
  );
  const authService = new AuthService(store, dummyPasswordHash, {
    passwordHasher: nodePasswordHasher
  });
  const userService = new UserService(store, {
    passwordHasher: nodePasswordHasher
  });
  const authorizationService = new AuthorizationService(store);
  const pool = createDatabasePool(config.databaseUrl);
  const repository = new PostgresProjectRepository(pool);

  return {
    authService,
    userService,
    authorizationService,
    projectService: new ProjectService(repository, authorizationService, store),
    memberService: new MemberService(repository, authorizationService, store),
    syncService: new SyncService(repository, authorizationService),
    close: () => pool.end()
  };
}
