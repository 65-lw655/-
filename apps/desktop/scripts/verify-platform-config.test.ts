import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

interface VerificationResult {
  ok: boolean;
  violations: Array<{ file: string; category: string }>;
}

interface VerifierModule {
  formatViolations(violations: VerificationResult["violations"]): string;
  verifyPlatformConfig(rootDir: string): VerificationResult;
}

let fixtureRoots: string[] = [];

async function loadVerifier(): Promise<VerifierModule> {
  return (await import("./verify-platform-config.mjs")) as VerifierModule;
}

function runVerifierCli(rootDir: string) {
  return spawnSync(
    globalThis.process.execPath,
    [fileURLToPath(new URL("./verify-platform-config.mjs", import.meta.url))],
    {
      cwd: rootDir,
      encoding: "utf8"
    }
  );
}

function createFixture(
  sourceText = "export const desktopOnly = true;\n"
): string {
  const root = mkdtempSync(join(tmpdir(), "desktop-platform-config-"));
  fixtureRoots.push(root);
  mkdirSync(join(root, "apps/desktop/src-tauri/capabilities"), {
    recursive: true
  });
  mkdirSync(join(root, "apps/desktop/src"), { recursive: true });
  writeFileSync(
    join(root, "apps/desktop/src-tauri/capabilities/default.json"),
    JSON.stringify({
      identifier: "default",
      windows: ["main"],
      permissions: ["core:event:default", "core:window:default"]
    })
  );
  writeFileSync(join(root, "apps/desktop/src/main.ts"), sourceText);
  writeFileSync(
    join(root, "apps/desktop/src-tauri/tauri.conf.json"),
    JSON.stringify({
      identifier: "cn.projectonline.desktop",
      app: { windows: [{ label: "main" }] }
    })
  );
  return root;
}

describe("verify-platform-config", () => {
  afterEach(() => {
    for (const root of fixtureRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    fixtureRoots = [];
  });

  it("accepts a clean desktop fixture", async () => {
    const verifier = await loadVerifier();

    expect(verifier.verifyPlatformConfig(createFixture())).toEqual({
      ok: true,
      violations: []
    });
  });

  it("exits zero for a clean desktop fixture", () => {
    const result = runVerifierCli(createFixture());

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
  });

  it("accepts the desktop workspace directory as the root", async () => {
    const verifier = await loadVerifier();
    const root = createFixture();

    expect(verifier.verifyPlatformConfig(join(root, "apps/desktop")).ok).toBe(
      true
    );
  });

  it("excludes Rust integration tests from production platform scanning", async () => {
    const verifier = await loadVerifier();
    const root = createFixture();
    mkdirSync(join(root, "apps/desktop/src-tauri/tests"), { recursive: true });
    writeFileSync(
      join(root, "apps/desktop/src-tauri/tests/capabilities.rs"),
      'const FORBIDDEN_TEST_VALUE: &str = "calendar";\n'
    );

    expect(verifier.verifyPlatformConfig(root).ok).toBe(true);
  });

  it.each([
    ["calendar", "calendar integration"],
    ["reminder", "reminder integration"],
    ["todo", "todo integration"],
    ["microsoft to do", "Microsoft To Do integration"],
    ["task integration", "task-system integration"]
  ])("rejects forbidden %s text", async (token, category) => {
    const verifier = await loadVerifier();
    const result = verifier.verifyPlatformConfig(
      createFixture(`export const forbidden = "${token}";\n`)
    );

    expect(result.ok).toBe(false);
    expect(result.violations).toContainEqual({
      file: "apps/desktop/src/main.ts",
      category
    });
    expect(verifier.formatViolations(result.violations)).not.toContain(
      "export const forbidden"
    );
  });

  it.each([
    ["calendar", "calendar integration"],
    ["reminder", "reminder integration"],
    ["todo", "todo integration"],
    ["microsoft to do", "Microsoft To Do integration"],
    ["task integration", "task-system integration"]
  ])(
    "exits non-zero without leaking forbidden %s source",
    (token, category) => {
      const result = runVerifierCli(
        createFixture(`export const forbidden = "${token}";\n`)
      );

      expect(result.status).toBe(1);
      expect(result.stderr.trim()).toBe(
        `apps/desktop/src/main.ts: ${category}`
      );
      expect(result.stderr).not.toContain("export const forbidden");
      expect(result.stdout).toBe("");
    }
  );

  it("rejects broad shell, filesystem, and sql capabilities", async () => {
    const root = createFixture();
    writeFileSync(
      join(root, "apps/desktop/src-tauri/capabilities/default.json"),
      JSON.stringify({
        identifier: "default",
        windows: ["main"],
        permissions: ["shell:default", "fs:default", "sql:default"]
      })
    );
    const verifier = await loadVerifier();

    expect(verifier.verifyPlatformConfig(root).violations).toEqual([
      {
        file: "apps/desktop/src-tauri/capabilities/default.json",
        category: "shell permission"
      },
      {
        file: "apps/desktop/src-tauri/capabilities/default.json",
        category: "filesystem permission"
      },
      {
        file: "apps/desktop/src-tauri/capabilities/default.json",
        category: "sql permission"
      }
    ]);
  });
});
