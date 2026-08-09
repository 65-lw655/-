import { randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  digestOpaqueSecret,
  generateOpaqueSecret
} from "../modules/auth/secrets.js";
import { createSecurityAuditEvent } from "../modules/audit/security-audit.js";
import { FileAuthStateStore } from "./file-auth-state-store.js";
import { MemoryAuthStateStore } from "./memory-auth-state-store.js";
import type { AuthState, StoredSecurityAuditEvent } from "./auth-state.js";

const temporaryDirectories: string[] = [];

async function makeStorePath(): Promise<{
  directoryPath: string;
  filePath: string;
}> {
  const temporaryDirectory = await mkdtemp(
    join(tmpdir(), "project-online-auth-store-")
  );
  temporaryDirectories.push(temporaryDirectory);

  const directoryPath = join(temporaryDirectory, "state");
  return {
    directoryPath,
    filePath: join(directoryPath, "auth-store.json")
  };
}

function makeAuditEvent(
  event: StoredSecurityAuditEvent["event"] = "LOGIN_SUCCEEDED"
): StoredSecurityAuditEvent {
  return {
    id: randomUUID(),
    event,
    result: "SUCCEEDED",
    actorId: null,
    targetId: null,
    projectId: null,
    sourceDigest: null,
    occurredAt: new Date().toISOString()
  };
}

async function writeExistingState(
  filePath: string,
  value: string
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, value, "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe("FileAuthStateStore", () => {
  it("initializes a missing store with format version 1", async () => {
    const { directoryPath, filePath } = await makeStorePath();

    const store = await FileAuthStateStore.open(filePath);

    await expect(store.read((state) => state)).resolves.toEqual({
      version: 1,
      users: [],
      sessions: [],
      tickets: [],
      loginAttempts: [],
      auditEvents: []
    });

    if (process.platform !== "win32") {
      expect((await stat(directoryPath)).mode & 0o777).toBe(0o700);
      expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    }
  });

  it("persists a successful update across reopen", async () => {
    const { filePath } = await makeStorePath();
    const event = makeAuditEvent();
    const store = await FileAuthStateStore.open(filePath);

    await store.update((state) => {
      state.auditEvents.push(event);
    });

    const reopened = await FileAuthStateStore.open(filePath);
    await expect(reopened.read((state) => state.auditEvents)).resolves.toEqual([
      event
    ]);
  });

  it("returns snapshots that cannot mutate the stored state", async () => {
    const { filePath } = await makeStorePath();
    const store = await FileAuthStateStore.open(filePath);
    const snapshot = await store.read((state) => state);

    snapshot.auditEvents.push(makeAuditEvent());

    await expect(store.read((state) => state.auditEvents)).resolves.toEqual([]);
  });

  it("serializes concurrent updates in call order", async () => {
    const { filePath } = await makeStorePath();
    const store = await FileAuthStateStore.open(filePath);
    const calls: string[] = [];
    const firstEvent = makeAuditEvent("SESSION_REFRESHED");
    const secondEvent = makeAuditEvent("SESSION_LOGGED_OUT");
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = store.update(async (state) => {
      calls.push("first:start");
      markFirstStarted();
      await firstBlocked;
      state.auditEvents.push(firstEvent);
      calls.push("first:end");
      return "first";
    });
    const second = store.update((state) => {
      calls.push("second");
      state.auditEvents.push(secondEvent);
      return "second";
    });

    await firstStarted;
    await Promise.resolve();
    expect(calls).toEqual(["first:start"]);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toEqual({
      version: 1,
      users: [],
      sessions: [],
      tickets: [],
      loginAttempts: [],
      auditEvents: []
    });

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      "first",
      "second"
    ]);
    expect(calls).toEqual(["first:start", "first:end", "second"]);
    await expect(
      store.read((state) => state.auditEvents.map(({ id }) => id))
    ).resolves.toEqual([firstEvent.id, secondEvent.id]);
  });

  it("does not commit a failed mutator and continues the update queue", async () => {
    const { filePath } = await makeStorePath();
    const storedEvent = makeAuditEvent();
    const rejectedEvent = makeAuditEvent("LOGIN_FAILED");
    const laterEvent = makeAuditEvent("USER_ENABLED");
    const store = await FileAuthStateStore.open(filePath);
    await store.update((state) => {
      state.auditEvents.push(storedEvent);
    });
    const beforeFailure = await readFile(filePath, "utf8");

    await expect(
      store.update((state) => {
        state.auditEvents.push(rejectedEvent);
        throw new Error("rejected update");
      })
    ).rejects.toThrow("rejected update");

    expect(await readFile(filePath, "utf8")).toBe(beforeFailure);
    await expect(
      store.read((state) => state.auditEvents.map(({ id }) => id))
    ).resolves.toEqual([storedEvent.id]);

    await store.update((state) => {
      state.auditEvents.push(laterEvent);
    });
    await expect(
      store.read((state) => state.auditEvents.map(({ id }) => id))
    ).resolves.toEqual([storedEvent.id, laterEvent.id]);
  });

  it("cleans a same-directory temporary file when replacement fails", async () => {
    const { directoryPath, filePath } = await makeStorePath();
    const store = await FileAuthStateStore.open(filePath);
    await rm(filePath);
    await mkdir(filePath);

    await expect(
      store.update((state) => {
        state.auditEvents.push(makeAuditEvent());
      })
    ).rejects.toThrow();

    const entries = await readdir(directoryPath);
    expect(entries.some((entry) => entry.endsWith(".tmp"))).toBe(false);
    await expect(store.read((state) => state.auditEvents)).resolves.toEqual([]);
  });

  it("rejects corrupt JSON without resetting the file", async () => {
    const { filePath } = await makeStorePath();
    const corruptJson = `{${randomUUID()}`;
    await writeExistingState(filePath, corruptJson);

    await expect(FileAuthStateStore.open(filePath)).rejects.toThrow();

    expect(await readFile(filePath, "utf8")).toBe(corruptJson);
  });

  it("rejects a format version other than 1", async () => {
    const { filePath } = await makeStorePath();
    await writeExistingState(
      filePath,
      JSON.stringify({
        version: 2,
        users: [],
        sessions: [],
        tickets: [],
        loginAttempts: [],
        auditEvents: []
      })
    );

    await expect(FileAuthStateStore.open(filePath)).rejects.toThrow();
  });

  it("rejects structurally invalid version 1 state", async () => {
    const { filePath } = await makeStorePath();
    await writeExistingState(
      filePath,
      JSON.stringify({
        version: 1,
        users: [{}],
        sessions: [],
        tickets: [],
        loginAttempts: [],
        auditEvents: []
      })
    );

    await expect(FileAuthStateStore.open(filePath)).rejects.toThrow();
  });

  it("persists only digests for runtime-generated credentials", async () => {
    const { filePath } = await makeStorePath();
    const password = generateOpaqueSecret();
    const sessionToken = generateOpaqueSecret();
    const credentialTicket = generateOpaqueSecret();
    const now = new Date().toISOString();
    const userId = randomUUID();
    const store = await FileAuthStateStore.open(filePath);

    await store.update((state) => {
      state.users.push({
        id: userId,
        username: `user-${randomUUID()}`,
        normalizedUsername: `normalized-${randomUUID()}`,
        displayName: `display-${randomUUID()}`,
        role: "USER",
        accountStatus: "ACTIVE",
        credentialStatus: "READY",
        passwordHash: digestOpaqueSecret(password),
        createdAt: now,
        updatedAt: now
      });
      state.sessions.push({
        id: randomUUID(),
        userId,
        tokenDigest: digestOpaqueSecret(sessionToken),
        deviceId: randomUUID(),
        platform: "WEB",
        deviceName: `device-${randomUUID()}`,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now,
        revokedAt: null,
        revocationReason: null
      });
      state.tickets.push({
        id: randomUUID(),
        userId,
        purpose: "ACTIVATION",
        ticketDigest: digestOpaqueSecret(credentialTicket),
        createdAt: now,
        expiresAt: now,
        consumedAt: null
      });
    });

    const serialized = await readFile(filePath, "utf8");
    expect(
      [password, sessionToken, credentialTicket].some((credential) =>
        serialized.includes(credential)
      )
    ).toBe(false);
    expect(
      [password, sessionToken, credentialTicket]
        .map(digestOpaqueSecret)
        .every((digest) => serialized.includes(digest))
    ).toBe(true);
  });

  it("restricts an existing POSIX store directory and file", async () => {
    if (process.platform === "win32") {
      return;
    }

    const { directoryPath, filePath } = await makeStorePath();
    await writeExistingState(
      filePath,
      JSON.stringify({
        version: 1,
        users: [],
        sessions: [],
        tickets: [],
        loginAttempts: [],
        auditEvents: []
      })
    );
    await chmod(directoryPath, 0o755);
    await chmod(filePath, 0o644);

    await FileAuthStateStore.open(filePath);

    expect((await stat(directoryPath)).mode & 0o777).toBe(0o700);
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
  });
});

describe("MemoryAuthStateStore", () => {
  it("isolates read snapshots", async () => {
    const store = new MemoryAuthStateStore();
    const event = makeAuditEvent();

    await store.update((state) => {
      state.auditEvents.push(event);
    });
    const snapshot = await store.read((state) => state as AuthState);
    snapshot.auditEvents.length = 0;

    await expect(store.read((state) => state.auditEvents)).resolves.toEqual([
      event
    ]);
  });

  it("does not commit a failed update", async () => {
    const store = new MemoryAuthStateStore();

    await expect(
      store.update((state) => {
        state.auditEvents.push(makeAuditEvent());
        throw new Error("rejected update");
      })
    ).rejects.toThrow("rejected update");

    await expect(store.read((state) => state.auditEvents)).resolves.toEqual([]);
  });

  it("serializes concurrent updates in call order", async () => {
    const store = new MemoryAuthStateStore();
    const firstEvent = makeAuditEvent("SESSION_REFRESHED");
    const secondEvent = makeAuditEvent("SESSION_LOGGED_OUT");
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = store.update(async (state) => {
      markFirstStarted();
      await firstBlocked;
      state.auditEvents.push(firstEvent);
    });
    const second = store.update((state) => {
      expect(state.auditEvents.map(({ id }) => id)).toEqual([firstEvent.id]);
      state.auditEvents.push(secondEvent);
    });

    await firstStarted;
    releaseFirst();
    await Promise.all([first, second]);
    await expect(
      store.read((state) => state.auditEvents.map(({ id }) => id))
    ).resolves.toEqual([firstEvent.id, secondEvent.id]);
  });
});

describe("createSecurityAuditEvent", () => {
  it("creates only the bounded structured audit record", () => {
    const input = {
      event: "AUTHORIZATION_DENIED",
      result: "DENIED",
      actorId: randomUUID(),
      targetId: randomUUID(),
      projectId: randomUUID(),
      sourceDigest: digestOpaqueSecret(generateOpaqueSecret()),
      occurredAt: new Date().toISOString()
    } as const;

    const event = createSecurityAuditEvent(input);

    expect(event).toEqual({ id: expect.any(String), ...input });
    expect(Object.keys(event).sort()).toEqual(
      [
        "id",
        "event",
        "result",
        "actorId",
        "targetId",
        "projectId",
        "sourceDigest",
        "occurredAt"
      ].sort()
    );
  });
});
