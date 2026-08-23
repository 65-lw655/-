import { spawnSync } from "node:child_process";
import process from "node:process";
import { fileURLToPath, URL } from "node:url";

const artifactPath = fileURLToPath(
  new URL("../dist/server.js", import.meta.url)
);
const result = spawnSync(process.execPath, [artifactPath], {
  encoding: "utf8",
  env: { ...process.env, APP_ENV: "test", DATABASE_URL: "" }
});

if (
  result.error !== undefined ||
  result.signal !== null ||
  result.status !== 1 ||
  result.stdout !== "" ||
  result.stderr !== "API failed to start\n"
) {
  process.stderr.write("API artifact smoke failed\n");
  process.exitCode = 1;
} else {
  process.stdout.write("API artifact smoke passed\n");
}
