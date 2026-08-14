import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";

import { parseApiConfig } from "./config.js";
import {
  ServiceError,
  type UserService
} from "./modules/users/user-service.js";
import { createRuntimeServices } from "./runtime.js";
import { readHiddenPassword } from "./terminal-password.js";

export interface BootstrapPrompt {
  readUsername(): Promise<string>;
  readDisplayName(): Promise<string>;
  readHiddenPassword(label: string): Promise<string>;
}

export async function runBootstrapAdmin(
  prompt: BootstrapPrompt,
  userService: UserService
): Promise<void> {
  const username = await prompt.readUsername();
  const displayName = await prompt.readDisplayName();
  const password = await prompt.readHiddenPassword("Password: ");
  const confirmation = await prompt.readHiddenPassword("Confirm password: ");
  if (password !== confirmation) {
    throw new Error("Passwords do not match");
  }

  await userService.bootstrapAdmin({ username, displayName, password });
  process.stdout.write("Administrator created\n");
}

async function readLine(label: string): Promise<string> {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout
  });
  try {
    return await terminal.question(label);
  } finally {
    terminal.close();
  }
}

function createTerminalPrompt(): BootstrapPrompt {
  return {
    readUsername: () => readLine("Username: "),
    readDisplayName: () => readLine("Display name: "),
    readHiddenPassword
  };
}

function safeBootstrapError(error: unknown): string {
  if (error instanceof ServiceError) {
    return error.message;
  }
  if (
    error instanceof Error &&
    [
      "Passwords do not match",
      "Password entry cancelled",
      "Hidden password input requires a TTY",
      "Production authentication store is not configured"
    ].includes(error.message)
  ) {
    return error.message;
  }
  return "Administrator bootstrap failed";
}

async function main(): Promise<void> {
  const config = parseApiConfig(process.env);
  const services = await createRuntimeServices(config);
  await runBootstrapAdmin(createTerminalPrompt(), services.userService);
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(entryPath).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(`${safeBootstrapError(error)}\n`);
    process.exitCode = 1;
  });
}
