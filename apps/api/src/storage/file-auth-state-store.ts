import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import type { AuthState, AuthStateStore } from "./auth-state.js";
import { assertAuthState } from "./auth-state-validation.js";

const isPosix = process.platform !== "win32";

function createEmptyState(): AuthState {
  return {
    version: 1,
    users: [],
    sessions: [],
    tickets: [],
    loginAttempts: [],
    auditEvents: []
  };
}

function isMissingFileError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function writeAtomically(
  filePath: string,
  state: AuthState
): Promise<void> {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${randomUUID()}.tmp`
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporaryPath, "wx", isPosix ? 0o600 : undefined);
    if (isPosix) {
      await handle.chmod(0o600);
    }
    await handle.writeFile(JSON.stringify(state), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await rm(temporaryPath, { force: true }).catch(() => undefined);
  }
}

export class FileAuthStateStore implements AuthStateStore {
  private updateQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private state: AuthState
  ) {}

  static async open(filePath: string): Promise<FileAuthStateStore> {
    const directoryPath = dirname(filePath);
    await mkdir(directoryPath, {
      recursive: true,
      ...(isPosix ? { mode: 0o700 } : {})
    });
    if (isPosix) {
      await chmod(directoryPath, 0o700);
    }

    let serialized: string;
    try {
      serialized = await readFile(filePath, "utf8");
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }

      const initialState = createEmptyState();
      await writeAtomically(filePath, initialState);
      return new FileAuthStateStore(filePath, initialState);
    }

    if (isPosix) {
      await chmod(filePath, 0o600);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(serialized);
    } catch (error) {
      throw new Error("Invalid authentication state JSON", { cause: error });
    }
    assertAuthState(parsed);
    return new FileAuthStateStore(filePath, structuredClone(parsed));
  }

  async read<T>(reader: (state: Readonly<AuthState>) => T): Promise<T> {
    await this.updateQueue;
    return reader(structuredClone(this.state));
  }

  update<T>(mutator: (state: AuthState) => T | Promise<T>): Promise<T> {
    const operation = this.updateQueue.then(async () => {
      const nextState = structuredClone(this.state);
      const result = await mutator(nextState);
      assertAuthState(nextState);
      const committedState = structuredClone(nextState);
      await writeAtomically(this.filePath, committedState);
      this.state = committedState;
      return result;
    });

    this.updateQueue = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }
}
