import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { Pool } from "pg";

export interface Migration {
  version: string;
  sql: string;
}

export async function loadMigrations(
  migrationsDirectory: string
): Promise<Migration[]> {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const migrations: Migration[] = [];

  for (const file of files) {
    migrations.push({
      version: basename(file, ".sql"),
      sql: await readFile(join(migrationsDirectory, file), "utf8")
    });
  }

  return migrations;
}

export async function runMigrations(
  pool: Pool,
  migrationsDirectory: string
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [730031]);
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL)"
    );

    for (const migration of await loadMigrations(migrationsDirectory)) {
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [migration.version]
      );
      if (applied.rowCount === 0) {
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now())",
          [migration.version]
        );
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
