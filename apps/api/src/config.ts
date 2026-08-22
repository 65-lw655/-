export type AppEnvironment = "development" | "test" | "production";

export interface ApiConfig {
  host: string;
  port: number;
  environment: AppEnvironment;
  webOrigin: string;
  authStorePath: string;
  databaseUrl?: string;
}

const APP_ENVIRONMENTS = new Set<AppEnvironment>([
  "development",
  "test",
  "production"
]);

function isAppEnvironment(value: string): value is AppEnvironment {
  return APP_ENVIRONMENTS.has(value as AppEnvironment);
}

export function parseApiConfig(
  env: Readonly<Record<string, string | undefined>>
): ApiConfig {
  const port = Number(env.API_PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  const environment = env.APP_ENV ?? "development";
  if (!isAppEnvironment(environment)) {
    throw new Error("APP_ENV must be development, test, or production");
  }

  const webOrigin = env.WEB_ORIGIN ?? "http://127.0.0.1:5173";
  try {
    const parsedOrigin = new URL(webOrigin);
    if (
      (parsedOrigin.protocol !== "http:" &&
        parsedOrigin.protocol !== "https:") ||
      parsedOrigin.origin !== webOrigin
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      "WEB_ORIGIN must be an HTTP(S) origin without path, query, or hash"
    );
  }

  const authStorePath = env.AUTH_STORE_PATH ?? ".local-data/auth-store.json";
  if (authStorePath.trim().length === 0) {
    throw new Error("AUTH_STORE_PATH must not be empty");
  }

  const databaseUrl = env.DATABASE_URL?.trim() ?? "";

  return {
    host: env.API_HOST?.trim() || "127.0.0.1",
    port,
    environment,
    webOrigin,
    authStorePath,
    databaseUrl
  };
}
