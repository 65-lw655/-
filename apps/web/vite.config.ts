import { resolve } from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

const environmentDirectory = resolve(import.meta.dirname, "../..");

export function resolveApiProxyTarget(
  env: Readonly<Record<string, string | undefined>>
): string {
  return env.VITE_DEV_API_PROXY_TARGET?.trim() || "http://127.0.0.1:3000";
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, environmentDirectory, "");
  return {
    plugins: [react()],
    envDir: environmentDirectory,
    server: {
      port: 5173,
      strictPort: true,
      proxy: {
        "/api": {
          target: resolveApiProxyTarget(env)
        }
      }
    }
  };
});
