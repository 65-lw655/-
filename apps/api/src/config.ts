export type AppEnvironment = "development" | "test" | "production";

export interface ApiConfig {
  host: string;
  port: number;
  environment: AppEnvironment;
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

  return {
    host: env.API_HOST?.trim() || "127.0.0.1",
    port,
    environment
  };
}
