import pg, { type Pool } from "pg";

export function createDatabasePool(connectionString: string): Pool {
  if (connectionString.trim().length === 0) {
    throw new Error("DATABASE_URL must not be empty");
  }

  const pool = new pg.Pool({ connectionString });
  pool.on("error", () => undefined);
  return pool;
}
