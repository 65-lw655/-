import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadMigrations, runMigrations } from "./migrate.js";
import { withTestDatabase } from "./test-database.js";

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

describe("loadMigrations", () => {
  it("loads only SQL migrations in version order", async () => {
    const directory = await mkdtemp(join(tmpdir(), "project-migrations-"));

    try {
      await writeFile(join(directory, "010_later.sql"), "SELECT 10;");
      await writeFile(join(directory, "002_earlier.sql"), "SELECT 2;");
      await writeFile(join(directory, "README.md"), "not a migration");

      await expect(loadMigrations(directory)).resolves.toEqual([
        { version: "002_earlier", sql: "SELECT 2;" },
        { version: "010_later", sql: "SELECT 10;" }
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("001_project_core migration", () => {
  it("defines usable project list filter and name search indexes", async () => {
    const sql = await readFile(
      join(migrationsDirectory, "001_project_core.sql"),
      "utf8"
    );

    expect(sql).toContain(
      "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;"
    );
    expect(sql).toContain("FROM pg_extension AS extension");
    expect(sql).toContain("JOIN pg_namespace AS namespace");
    expect(sql).toContain("namespace.nspname <> 'public'");
    expect(sql).toContain(
      "RAISE EXCEPTION 'pg_trgm extension must be installed in public schema';"
    );
    expect(sql).toContain(
      "CREATE INDEX projects_lifecycle_idx ON projects (lifecycle);"
    );
    expect(sql).toContain("CREATE INDEX projects_year_idx ON projects (year);");
    expect(sql).toContain(
      "CREATE INDEX projects_status_idx ON projects (status);"
    );
    expect(sql).toContain(
      "CREATE INDEX projects_updated_at_idx ON projects (updated_at DESC);"
    );
    expect(sql).toContain(
      "CREATE INDEX projects_name_trgm_idx ON projects USING gin (name public.gin_trgm_ops);"
    );
    expect(sql).not.toContain("(name gin_trgm_ops)");
    expect(sql).not.toContain("projects_lifecycle_year_status_idx");
    expect(sql).not.toContain(
      "CREATE INDEX projects_name_idx ON projects (name);"
    );
  });
});

describe("runMigrations", () => {
  it("creates the M3 schema once and records migration 001", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      await runMigrations(pool, migrationsDirectory);
      const applied = await pool.query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version"
      );
      expect(applied.rows).toEqual([{ version: "001_project_core" }]);
    });
  });
});
