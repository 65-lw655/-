import { buildApp } from "./app.js";
import { parseApiConfig } from "./config.js";
import { createRuntimeServices } from "./runtime.js";

async function start(): Promise<void> {
  const config = parseApiConfig(process.env);
  const services = await createRuntimeServices(config);
  const app = buildApp(config, services);

  await app.listen({
    host: config.host,
    port: config.port
  });
}

start().catch(() => {
  process.stderr.write("API failed to start\n");
  process.exitCode = 1;
});
