#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const FORBIDDEN_TEXT = [
  { pattern: /\bcalendar\b/iu, category: "calendar integration" },
  { pattern: /\breminder\b/iu, category: "reminder integration" },
  { pattern: /\btodo\b/iu, category: "todo integration" },
  {
    pattern: /\bmicrosoft\s+to\s+do\b/iu,
    category: "Microsoft To Do integration"
  },
  { pattern: /\btask\s+integration\b/iu, category: "task-system integration" }
];

const SCANNED_EXTENSIONS = new Set([
  ".html",
  ".json",
  ".mjs",
  ".rs",
  ".toml",
  ".ts",
  ".tsx"
]);

const SKIPPED_DIRS = new Set([
  "dist",
  "gen",
  "node_modules",
  "target",
  "tests"
]);

function toRelative(rootDir, filePath) {
  return relative(rootDir, filePath).split(sep).join("/");
}

function shouldSkipFile(filePath) {
  const name = basename(filePath);
  return (
    name === "verify-platform-config.mjs" ||
    name.includes(".test.") ||
    name.endsWith("_test.rs")
  );
}

function listDesktopFiles(rootDir) {
  const desktopRoot = desktopRootFrom(rootDir);
  const files = [];

  function visit(dir) {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry)) {
          visit(path);
        }
        continue;
      }
      if (stat.isFile() && SCANNED_EXTENSIONS.has(extname(path))) {
        files.push(path);
      }
    }
  }

  visit(desktopRoot);
  return files;
}

function desktopRootFrom(rootDir) {
  const nestedDesktopRoot = join(rootDir, "apps/desktop");
  if (existsSync(nestedDesktopRoot)) {
    return nestedDesktopRoot;
  }
  if (
    basename(rootDir) === "desktop" &&
    basename(dirname(rootDir)) === "apps" &&
    existsSync(join(rootDir, "src-tauri"))
  ) {
    return rootDir;
  }
  return nestedDesktopRoot;
}

function repositoryRootFrom(rootDir) {
  if (
    basename(rootDir) === "desktop" &&
    basename(dirname(rootDir)) === "apps" &&
    existsSync(join(rootDir, "src-tauri"))
  ) {
    return dirname(dirname(rootDir));
  }
  return rootDir;
}

function verifyTextFile(rootDir, filePath) {
  if (shouldSkipFile(filePath)) {
    return [];
  }

  const relativePath = toRelative(rootDir, filePath);
  const content = readFileSync(filePath, "utf8");
  return FORBIDDEN_TEXT.filter(({ pattern }) => pattern.test(content)).map(
    ({ category }) => ({
      file: relativePath,
      category
    })
  );
}

function permissionName(permission) {
  if (typeof permission === "string") {
    return permission;
  }
  if (
    permission !== null &&
    typeof permission === "object" &&
    typeof permission.identifier === "string"
  ) {
    return permission.identifier;
  }
  return "";
}

function verifyCapabilityFile(rootDir, filePath) {
  const relativePath = toRelative(rootDir, filePath);
  const parsed = JSON.parse(readFileSync(filePath, "utf8"));
  const permissions = Array.isArray(parsed.permissions)
    ? parsed.permissions
    : [];
  const names = permissions.map((permission) =>
    permissionName(permission).toLowerCase()
  );
  const violations = [];

  if (names.some((name) => name.startsWith("shell:") || name === "shell")) {
    violations.push({ file: relativePath, category: "shell permission" });
  }
  if (
    names.some(
      (name) =>
        name === "fs" ||
        name === "fs:default" ||
        name === "fs:allow-all" ||
        name === "filesystem" ||
        name === "filesystem:default"
    )
  ) {
    violations.push({ file: relativePath, category: "filesystem permission" });
  }
  if (names.some((name) => name.startsWith("sql:") || name === "sql")) {
    violations.push({ file: relativePath, category: "sql permission" });
  }

  return violations;
}

export function verifyPlatformConfig(rootDir = globalThis.process.cwd()) {
  const violations = [];
  const repositoryRoot = repositoryRootFrom(rootDir);

  for (const filePath of listDesktopFiles(rootDir)) {
    violations.push(...verifyTextFile(repositoryRoot, filePath));
    if (
      toRelative(repositoryRoot, filePath).startsWith(
        "apps/desktop/src-tauri/capabilities/"
      )
    ) {
      violations.push(...verifyCapabilityFile(repositoryRoot, filePath));
    }
  }

  return {
    ok: violations.length === 0,
    violations
  };
}

export function formatViolations(violations) {
  return violations
    .map(({ file, category }) => `${file}: ${category}`)
    .join("\n");
}

if (import.meta.url === pathToFileURL(globalThis.process.argv[1]).href) {
  const result = verifyPlatformConfig(globalThis.process.cwd());
  if (!result.ok) {
    globalThis.console.error(formatViolations(result.violations));
    globalThis.process.exitCode = 1;
  }
}
