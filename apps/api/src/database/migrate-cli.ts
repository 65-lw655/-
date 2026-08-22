import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runMigrations } from "./migrate.js";
import { createDatabasePool } from "./pool.js";

const migrationsDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "migrations"
);

async function migrate(): Promise<void> {
  const pool = createDatabasePool(process.env.DATABASE_URL ?? "");
  try {
    await runMigrations(pool, migrationsDirectory);
  } finally {
    await pool.end();
  }
}

migrate().catch(() => {
  process.stderr.write("Database migration failed\n");
  process.exitCode = 1;
});
