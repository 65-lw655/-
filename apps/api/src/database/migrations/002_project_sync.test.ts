import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { runMigrations } from "../migrate.js";
import { withTestDatabase } from "../test-database.js";

const migrationsDirectory = dirname(fileURLToPath(import.meta.url));

describe("002_project_sync migration", () => {
  it("creates sync result and project change tables once", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);
      await runMigrations(pool, migrationsDirectory);

      const tables = await pool.query<{ table_name: string }>(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = current_schema()
            AND table_name IN ('sync_operation_results', 'project_change_log')
          ORDER BY table_name`
      );
      const applied = await pool.query<{ version: string }>(
        "SELECT version FROM schema_migrations ORDER BY version"
      );

      expect(tables.rows).toEqual([
        { table_name: "project_change_log" },
        { table_name: "sync_operation_results" }
      ]);
      expect(applied.rows).toEqual([
        { version: "001_project_core" },
        { version: "002_project_sync" }
      ]);
    });
  });

  it("enforces one immutable result per device and operation id", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);

      const projectId = randomUUID();
      const actorUserId = randomUUID();
      const deviceId = randomUUID();
      const operationId = randomUUID();

      await pool.query(
        `INSERT INTO projects (
           id, name, year, type, status, phase, lifecycle, filing_status,
           planned_completion_date, actual_completion_date,
           created_at, created_by, updated_at, updated_by,
           revision, commit_sequence, archived_at, archived_by
         ) VALUES (
           $1, '同步迁移测试项目', 2026, '展览展示', '施工中', '实施', 'ACTIVE', '无需报建',
           NULL, NULL,
           TIMESTAMPTZ '2026-08-24T10:00:00Z', $2, TIMESTAMPTZ '2026-08-24T10:00:00Z', $2,
           1, 1, NULL, NULL
         )`,
        [projectId, actorUserId]
      );

      await pool.query(
        `INSERT INTO sync_operation_results (
           device_id, operation_id, project_id, entity_id, entity_type,
           status, result_payload, error_code, created_at, actor_user_id
         ) VALUES (
           $1, $2, $3, $3, 'PROJECT',
           'ACCEPTED', '{"status":"ACCEPTED"}'::jsonb, NULL,
           TIMESTAMPTZ '2026-08-24T10:01:00Z', $4
         )`,
        [deviceId, operationId, projectId, actorUserId]
      );

      await expect(
        pool.query(
          `INSERT INTO sync_operation_results (
             device_id, operation_id, project_id, entity_id, entity_type,
             status, result_payload, error_code, created_at, actor_user_id
           ) VALUES (
             $1, $2, $3, $3, 'PROJECT',
             'DUPLICATE', '{"status":"DUPLICATE"}'::jsonb, NULL,
             TIMESTAMPTZ '2026-08-24T10:02:00Z', $4
           )`,
          [deviceId, operationId, projectId, actorUserId]
        )
      ).rejects.toThrow(/duplicate key value/u);

      const lookup = await pool.query<{
        status: string;
        result_payload: { status: string };
      }>(
        `SELECT status, result_payload
           FROM sync_operation_results
          WHERE device_id = $1
            AND operation_id = $2`,
        [deviceId, operationId]
      );

      expect(lookup.rows).toEqual([
        { status: "ACCEPTED", result_payload: { status: "ACCEPTED" } }
      ]);
    });
  });

  it("stores append-only project changes ordered by commit sequence", async () => {
    await withTestDatabase(async (pool) => {
      await runMigrations(pool, migrationsDirectory);

      const projectId = randomUUID();
      const actorUserId = randomUUID();

      await pool.query(
        `INSERT INTO projects (
           id, name, year, type, status, phase, lifecycle, filing_status,
           planned_completion_date, actual_completion_date,
           created_at, created_by, updated_at, updated_by,
           revision, commit_sequence, archived_at, archived_by
         ) VALUES (
           $1, '变更日志测试项目', 2026, '展览展示', '施工中', '实施', 'ACTIVE', '无需报建',
           NULL, NULL,
           TIMESTAMPTZ '2026-08-24T11:00:00Z', $2, TIMESTAMPTZ '2026-08-24T11:00:00Z', $2,
           1, 10, NULL, NULL
         )`,
        [projectId, actorUserId]
      );

      await pool.query(
        `INSERT INTO project_change_log (
           commit_sequence, project_id, entity_id, entity_type, revision,
           deleted, project_snapshot, actor_user_id, changed_at
         ) VALUES
           (11, $1, $1, 'PROJECT', 2, false, '{"name":"版本二"}'::jsonb, $2, TIMESTAMPTZ '2026-08-24T11:01:00Z'),
           (12, $1, $1, 'PROJECT', 3, true, NULL, $2, TIMESTAMPTZ '2026-08-24T11:02:00Z')`,
        [projectId, actorUserId]
      );

      await expect(
        pool.query(
          `INSERT INTO project_change_log (
             commit_sequence, project_id, entity_id, entity_type, revision,
             deleted, project_snapshot, actor_user_id, changed_at
           ) VALUES (
             12, $1, $1, 'PROJECT', 4, false, '{"name":"重复序号"}'::jsonb, $2, TIMESTAMPTZ '2026-08-24T11:03:00Z'
           )`,
          [projectId, actorUserId]
        )
      ).rejects.toThrow(/duplicate key value/u);

      const page = await pool.query<{
        commit_sequence: string;
        revision: number;
        deleted: boolean;
      }>(
        `SELECT commit_sequence::text, revision, deleted
           FROM project_change_log
          WHERE project_id = $1
            AND commit_sequence > 10
          ORDER BY commit_sequence ASC`,
        [projectId]
      );

      expect(page.rows).toEqual([
        { commit_sequence: "11", revision: 2, deleted: false },
        { commit_sequence: "12", revision: 3, deleted: true }
      ]);
    });
  });
});
