import { buildApp, listenWithCleanup } from "./app.js";
import { parseApiConfig } from "./config.js";
import { createRuntimeServices } from "./runtime.js";

async function start(): Promise<void> {
  const config = parseApiConfig(process.env);
  const services = await createRuntimeServices(config);
  const app = buildApp(config, services);
  const shutdown = () => {
    void app.close().catch(() => {
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await listenWithCleanup(app, {
    host: config.host,
    port: config.port
  });
}

start().catch(() => {
  process.stderr.write("API failed to start\n");
  process.exitCode = 1;
});
