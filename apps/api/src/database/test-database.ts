import { randomUUID } from "node:crypto";

import pg, { type Pool } from "pg";

import { createDatabasePool } from "./pool.js";

export async function withTestDatabase(
  test: (pool: Pool) => Promise<void>
): Promise<void> {
  const connectionString = process.env.TEST_DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("TEST_DATABASE_URL must not be empty");
  }

  const schemaName = `project_test_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createDatabasePool(connectionString);
  let schemaCreated = false;
  let testPool: Pool | undefined;

  try {
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    testPool = new pg.Pool({
      connectionString,
      options: `-c search_path=${schemaName}`
    });
    await test(testPool);
  } finally {
    if (testPool) {
      await testPool.end();
    }
    try {
      if (schemaCreated) {
        await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
    } finally {
      await adminPool.end();
    }
  }
}
