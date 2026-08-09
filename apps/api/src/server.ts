import { buildApp } from "./app.js";
import { parseApiConfig } from "./config.js";

async function start(): Promise<void> {
  const config = parseApiConfig(process.env);
  const app = buildApp(config);

  await app.listen({
    host: config.host,
    port: config.port
  });
}

start().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`API failed to start: ${message}\n`);
  process.exitCode = 1;
});
