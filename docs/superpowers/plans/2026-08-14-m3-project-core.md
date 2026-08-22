# M3 Project Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete M3 online project and member-management vertical slice with PostgreSQL persistence, server-side authorization, audit history, and responsive React workflows.

**Architecture:** Keep M2 identity and sessions in `AuthStateStore`, while project, member, and business-audit records use PostgreSQL through native `pg` and parameterized SQL. Fastify routes validate HTTP input, application services combine real-time M2 authorization with PostgreSQL transactions, and React feature components call typed clients without adding a router or state-management library.

**Tech Stack:** Node.js 22, TypeScript 6, Fastify 5, native `pg`, PostgreSQL 16, React 19, Vitest 4, Testing Library, Docker Compose, GitHub Actions

## Global Constraints

- Do not read, convert, or migrate any existing local project data.
- Use native `pg`, parameterized SQL, and versioned SQL migrations; do not add an ORM.
- Keep M2 users, sessions, and security audit in the existing `AuthStateStore`.
- Store project, member, business-audit, and commit-sequence data in PostgreSQL.
- Use fictional development and test data only; never hardcode real credentials or tokens.
- Use server-derived actor IDs and UTC timestamps; clients cannot submit audit identity fields.
- Later successful submissions overwrite earlier values; do not reject stale client revisions.
- Every successful project or member mutation must update project `revision`, obtain one commit sequence, and write one audit event in the same PostgreSQL transaction.
- PostgreSQL sequence gaps after rollback are allowed; committed sequence values remain unique and increasing.
- Do not automatically create Git commits. Each task ends with a manual commit checkpoint for the user.

---

## File Structure

### Shared domain

- `packages/domain/src/projects/types.ts`: project, member, audit, filter, and permission contracts.
- `packages/domain/src/projects/validation.ts`: pure project and member input validation.
- `packages/domain/src/projects/validation.test.ts`: validation and invariant unit tests.
- `packages/domain/src/index.ts`: public exports used by API and Web.

### API and PostgreSQL

- `apps/api/src/database/pool.ts`: `pg.Pool` creation and safe shutdown.
- `apps/api/src/database/migrate.ts`: ordered SQL migration runner.
- `apps/api/src/database/migrate-cli.ts`: explicit migration command entry point.
- `apps/api/src/database/test-database.ts`: isolated integration-test schema setup.
- `apps/api/src/database/migrations/001_project_core.sql`: M3 tables, indexes, constraints, and global sequence.
- `apps/api/src/modules/projects/project-repository.ts`: repository and transaction interfaces.
- `apps/api/src/modules/projects/postgres-project-repository.ts`: parameterized PostgreSQL implementation.
- `apps/api/src/modules/projects/project-service.ts`: project list, detail, create, edit, archive, restore, and audit workflows.
- `apps/api/src/modules/projects/member-service.ts`: member listing, candidate search, add, edit, and remove workflows.
- `apps/api/src/modules/projects/project-service-error.ts`: stable business error codes independent of HTTP.
- `apps/api/src/modules/projects/schemas.ts`: shared Fastify request and response schemas.
- `apps/api/src/modules/projects/routes.ts`: project, member, and audit HTTP routes.
- Adjacent `*.test.ts` and `*.integration.test.ts` files: service, route, migration, and repository coverage.

### Web

- `apps/web/src/features/projects/projects-client.ts`: typed API client and response guards.
- `apps/web/src/features/projects/ProjectsView.tsx`: project workspace navigation and shared request handling.
- `apps/web/src/features/projects/ProjectListView.tsx`: filters, pagination, empty states, and create entry.
- `apps/web/src/features/projects/ProjectEditorDialog.tsx`: create and edit form.
- `apps/web/src/features/projects/ProjectDetailView.tsx`: project details, lifecycle actions, and audit timeline.
- `apps/web/src/features/projects/ProjectMembersPanel.tsx`: member list, candidate search, add, edit, and remove UI.
- Adjacent `*.test.tsx` files: browser-facing state and permission behavior.

### Runtime and tooling

- `docker-compose.yml`: isolated local PostgreSQL 16 service and named volume.
- `.env.example`: non-secret PostgreSQL variable examples.
- `package.json`, `apps/api/package.json`, `package-lock.json`: dependency and database scripts.
- `vitest.integration.config.ts`: PostgreSQL-only test selection.
- `.github/workflows/verify.yml`: PostgreSQL service, migration, integration tests, and existing verification.

---

### Task 1: Define Project Domain Contracts

**Files:**
- Create: `packages/domain/src/projects/types.ts`
- Create: `packages/domain/src/projects/validation.ts`
- Create: `packages/domain/src/projects/validation.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Consumes: existing `ProjectMemberRole` from `packages/domain/src/auth/types.ts`.
- Produces: `ProjectStatus`, `ProjectLifecycle`, `ProjectInput`, `ProjectRecord`, `ProjectMemberRecord`, `ProjectListFilters`, `ProjectPermissions`, `ProjectAuditEvent`, `validateProjectInput()`, and `validateMemberInput()`.

- [ ] **Step 1: Write failing validation tests**

```ts
import { describe, expect, it } from "vitest";

import { validateMemberInput, validateProjectInput } from "./validation.js";

describe("validateProjectInput", () => {
  it("accepts the M3 project fields", () => {
    expect(
      validateProjectInput({
        name: "虚构展陈项目",
        year: 2026,
        type: "展览展示",
        status: "施工中",
        phase: "现场实施",
        filingStatus: "无需报建",
        plannedCompletionDate: "2026-12-31",
        actualCompletionDate: null
      })
    ).toEqual({ ok: true });
  });

  it("rejects blank names and invalid business dates", () => {
    expect(validateProjectInput({ name: " ", year: 2026 })).toMatchObject({
      ok: false
    });
    expect(
      validateProjectInput({ name: "虚构项目", year: 2026, plannedCompletionDate: "2026-02-30" })
    ).toMatchObject({ ok: false });
  });
});

describe("validateMemberInput", () => {
  it("accepts all three project roles and bounded profile fields", () => {
    for (const memberRole of ["OWNER", "EDITOR", "VIEWER"] as const) {
      expect(validateMemberInput({ memberRole, jobTitle: "项目经理", phone: "", remark: "" })).toEqual({ ok: true });
    }
  });
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm run test -- --run packages/domain/src/projects/validation.test.ts`

Expected: FAIL because `validation.ts` does not exist.

- [ ] **Step 3: Add the minimum shared contracts and validators**

```ts
export const PROJECT_STATUSES = [
  "中标待签",
  "施工中",
  "深化中",
  "完工未验收",
  "待验收",
  "验收未结算",
  "结算未回款",
  "已结算待回款"
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type ProjectLifecycle = "ACTIVE" | "ARCHIVED";

export interface ProjectInput {
  name: string;
  year: number;
  type: string;
  status: ProjectStatus;
  phase: string;
  filingStatus: string;
  plannedCompletionDate: string | null;
  actualCompletionDate: string | null;
}

export interface ValidationResult {
  ok: boolean;
  fields?: Readonly<Record<string, string>>;
}
```

Implement exact limits: project name 1-200 characters, year 1900-2100, type/phase/filing status 0-100 characters, member job title 0-100, phone 0-50, remark 0-1000, and real `YYYY-MM-DD` dates or `null`.

- [ ] **Step 4: Export the contracts and run domain tests**

```ts
export * from "./projects/types.js";
export { validateMemberInput, validateProjectInput } from "./projects/validation.js";
```

Run: `npm run test -- --run packages/domain/src/projects/validation.test.ts packages/domain/src/auth/authorization.test.ts`

Expected: PASS.

- [ ] **Step 5: Manual commit checkpoint**

```bash
git add packages/domain/src/projects packages/domain/src/index.ts
git commit -m "feat: define M3 project domain contracts"
```

### Task 2: Add PostgreSQL Runtime and Migrations

**Files:**
- Create: `docker-compose.yml`
- Create: `vitest.integration.config.ts`
- Create: `apps/api/src/database/pool.ts`
- Create: `apps/api/src/database/migrate.ts`
- Create: `apps/api/src/database/migrate-cli.ts`
- Create: `apps/api/src/database/test-database.ts`
- Create: `apps/api/src/database/migrations/001_project_core.sql`
- Create: `apps/api/src/database/migrate.integration.test.ts`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `apps/api/package.json`
- Modify: `package-lock.json`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/app.test.ts`

**Interfaces:**
- Consumes: `DATABASE_URL` and `TEST_DATABASE_URL` environment variables.
- Produces: `createDatabasePool(connectionString): Pool`, `runMigrations(pool, migrationsDirectory): Promise<void>`, and `withTestDatabase(test): Promise<void>`.

- [ ] **Step 1: Add `pg` and database scripts**

Run: `npm install pg @types/pg --workspace @project-online/api`

Add scripts:

```json
{
  "db:migrate": "npm run db:migrate --workspace @project-online/api",
  "test:db": "vitest --config vitest.integration.config.ts --run"
}
```

```json
{
  "db:migrate": "tsx src/database/migrate-cli.ts"
}
```

- [ ] **Step 2: Write the failing migration integration test**

```ts
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
```

Run: `npm run test:db -- apps/api/src/database/migrate.integration.test.ts`

Expected: FAIL because the database helpers and migration do not exist.

- [ ] **Step 3: Create the versioned schema**

The first migration must include these constraints and indexes:

```sql
CREATE SEQUENCE project_commit_sequence AS bigint START WITH 1;

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  name varchar(200) NOT NULL,
  year integer NOT NULL CHECK (year BETWEEN 1900 AND 2100),
  type varchar(100) NOT NULL,
  status varchar(32) NOT NULL,
  phase varchar(100) NOT NULL,
  lifecycle varchar(16) NOT NULL CHECK (lifecycle IN ('ACTIVE', 'ARCHIVED')),
  filing_status varchar(100) NOT NULL,
  planned_completion_date date,
  actual_completion_date date,
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL,
  revision integer NOT NULL CHECK (revision >= 1),
  commit_sequence bigint NOT NULL UNIQUE,
  archived_at timestamptz,
  archived_by uuid
);

CREATE TABLE project_members (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  member_role varchar(16) NOT NULL CHECK (member_role IN ('OWNER', 'EDITOR', 'VIEWER')),
  job_title varchar(100) NOT NULL DEFAULT '',
  phone varchar(50) NOT NULL DEFAULT '',
  remark varchar(1000) NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL,
  updated_at timestamptz NOT NULL,
  updated_by uuid NOT NULL,
  UNIQUE (project_id, user_id)
);
```

Add an explicit `status IN (...)` check containing all eight Task 1 values. Also create `project_audit_events`, a unique constraint on its `commit_sequence`, its `(project_id, commit_sequence DESC)` index, project list filter indexes, and `schema_migrations`. Store `change_summary` as `jsonb` and validate event/target types with checks.

- [ ] **Step 4: Implement explicit migration execution and test isolation**

```ts
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
    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const version = basename(file, ".sql");
      const applied = await client.query(
        "SELECT 1 FROM schema_migrations WHERE version = $1",
        [version]
      );
      if (applied.rowCount === 0) {
        await client.query(await readFile(join(migrationsDirectory, file), "utf8"));
        await client.query(
          "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now())",
          [version]
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
```

`withTestDatabase` must require `TEST_DATABASE_URL`, create a uniquely named temporary schema, set `search_path` for its pool, and drop only that schema in `finally`. It must never default to `DATABASE_URL`.

- [ ] **Step 5: Add local Compose and non-secret environment examples**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER:?Set POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Set POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB:?Set POSTGRES_DB}
    ports:
      - "127.0.0.1:5432:5432"
    volumes:
      - project-online-postgres:/var/lib/postgresql/data
volumes:
  project-online-postgres:
```

Extend `ApiConfig` with `databaseUrl`; require a non-empty `DATABASE_URL` only when creating runtime database services. Keep `buildApp` unit tests independent of PostgreSQL by supplying an explicit inert test value.

- [ ] **Step 6: Run migration and configuration tests**

Run: `npm run test -- --run apps/api/src/config.test.ts apps/api/src/app.test.ts`

Run with isolated PostgreSQL available: `npm run test:db -- apps/api/src/database/migrate.integration.test.ts`

Expected: PASS, with no existing local project file read.

- [ ] **Step 7: Manual commit checkpoint**

```bash
git add docker-compose.yml .env.example package.json package-lock.json apps/api/package.json apps/api/src/database apps/api/src/config.ts apps/api/src/config.test.ts apps/api/src/app.test.ts vitest.integration.config.ts
git commit -m "feat: add M3 PostgreSQL foundation"
```

### Task 3: Implement the PostgreSQL Project Repository

**Files:**
- Create: `apps/api/src/modules/projects/project-repository.ts`
- Create: `apps/api/src/modules/projects/postgres-project-repository.ts`
- Create: `apps/api/src/modules/projects/postgres-project-repository.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 domain records and Task 2 `pg.Pool`.
- Produces: `ProjectRepository`, `ProjectTransaction`, `ProjectAccessRecord`, and `PostgresProjectRepository`.

- [ ] **Step 1: Define repository transaction contracts**

```ts
export interface ProjectRepository {
  listProjects(scope: "ALL" | { userId: string }, filters: ProjectListFilters): Promise<ProjectPage>;
  transaction<T>(work: (transaction: ProjectTransaction) => Promise<T>): Promise<T>;
}

export interface ProjectTransaction {
  getAccess(projectId: string, userId: string, lock: boolean): Promise<ProjectAccessRecord>;
  createProject(input: CreateProjectRecord): Promise<ProjectRecord>;
  updateProject(input: UpdateProjectRecord): Promise<ProjectRecord>;
  setLifecycle(input: SetProjectLifecycleRecord): Promise<ProjectRecord>;
  listMembers(projectId: string): Promise<ProjectMemberRecord[]>;
  addMember(input: CreateMemberRecord): Promise<ProjectMemberRecord>;
  updateMember(input: UpdateMemberRecord): Promise<ProjectMemberRecord>;
  removeMember(projectId: string, memberId: string): Promise<ProjectMemberRecord>;
  countOwners(projectId: string): Promise<number>;
  writeAudit(event: CreateProjectAuditEvent): Promise<void>;
  listAudit(projectId: string, page: number, pageSize: number): Promise<ProjectAuditPage>;
  nextCommitSequence(): Promise<number>;
}
```

- [ ] **Step 2: Write failing repository integration tests**

Use a real migrated test schema and verify the atomic create path directly:

```ts
it("creates a project, initial owner, and audit event atomically", async () => {
  await withTestDatabase(async (pool) => {
    await runMigrations(pool, migrationsDirectory);
    const repository = new PostgresProjectRepository(pool);
    const result = await createProjectFixture(repository, {
      actorUserId,
      ownerUserId
    });
    const counts = await pool.query<{
      projects: number;
      members: number;
      events: number;
    }>(`SELECT
          (SELECT count(*)::int FROM projects) AS projects,
          (SELECT count(*)::int FROM project_members) AS members,
          (SELECT count(*)::int FROM project_audit_events) AS events`);
    expect(result.project.revision).toBe(1);
    expect(counts.rows[0]).toEqual({ projects: 1, members: 1, events: 1 });
  });
});
```

In the same file, define `createProjectFixture()` with complete fictional `CreateProjectRecord`, `CreateMemberRecord`, and `CreateProjectAuditEvent` values. Add four executable tests that assert: USER list IDs equal only joined project IDs while ALL scope returns both fixtures; two successive updates return revisions 2 and 3 with increasing sequences; a forced audit constraint failure leaves the original project unchanged; and `getAccess(projectId, userId, true)` blocks a second transaction until the first commits.

Run: `npm run test:db -- apps/api/src/modules/projects/postgres-project-repository.integration.test.ts`

Expected: FAIL because `PostgresProjectRepository` does not exist.

- [ ] **Step 3: Implement row mapping and parameterized queries**

Use `$1`, `$2`, and later placeholders exclusively. Map `date` columns to `YYYY-MM-DD`, `timestamptz` to ISO strings, and PostgreSQL `bigint` strings to safe JavaScript numbers after checking `Number.isSafeInteger`.

```ts
const result = await client.query<ProjectRow>(
  `SELECT p.*
     FROM projects p
    WHERE ($1::text IS NULL OR p.name ILIKE '%' || $1 || '%')
      AND ($2::integer IS NULL OR p.year = $2)
    ORDER BY p.updated_at DESC, p.id ASC
    LIMIT $3 OFFSET $4`,
  [filters.query ?? null, filters.year ?? null, filters.pageSize, offset]
);
```

- [ ] **Step 4: Implement transaction ownership and rollback**

```ts
async transaction<T>(work: (transaction: ProjectTransaction) => Promise<T>): Promise<T> {
  const client = await this.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(new PostgresProjectTransaction(client));
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
```

Mutation methods must receive server-generated IDs, actor IDs, timestamps, revisions, and commit sequences from the service; SQL must not accept audit actor identity from HTTP input.

- [ ] **Step 5: Run repository integration tests**

Run: `npm run test:db -- apps/api/src/modules/projects/postgres-project-repository.integration.test.ts`

Expected: PASS.

- [ ] **Step 6: Manual commit checkpoint**

```bash
git add apps/api/src/modules/projects/project-repository.ts apps/api/src/modules/projects/postgres-project-repository.ts apps/api/src/modules/projects/postgres-project-repository.integration.test.ts
git commit -m "feat: add PostgreSQL project repository"
```

### Task 4: Implement Project Application Workflows

**Files:**
- Create: `apps/api/src/modules/projects/project-service-error.ts`
- Create: `apps/api/src/modules/projects/project-service.ts`
- Create: `apps/api/src/modules/projects/project-service.test.ts`

**Interfaces:**
- Consumes: `ProjectRepository`, `AuthorizationService`, `AuthStateStore`, `AuthenticatedPrincipal`, and Task 1 validators.
- Produces: `ProjectService.listProjects()`, `createProject()`, `getProject()`, `updateProject()`, `archiveProject()`, `restoreProject()`, and `listAuditEvents()`.

- [ ] **Step 1: Write service permission and transaction tests**

```ts
it.each([
  ["OWNER", true],
  ["EDITOR", true],
  ["VIEWER", false]
] as const)("maps %s project edit permission", async (memberRole, allowed) => {
  const harness = createProjectServiceHarness({
    principalRole: "USER",
    memberRole
  });
  const request = harness.service.updateProject(
    harness.principal,
    harness.projectId,
    harness.validProjectInput
  );
  if (allowed) {
    await expect(request).resolves.toMatchObject({ revision: 2 });
    expect(harness.repository.auditEvents).toHaveLength(1);
  } else {
    await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(harness.repository.auditEvents).toHaveLength(0);
  }
});
```

Define `createProjectServiceHarness()` in the test file with `MemoryAuthStateStore`, real `AuthorizationService`, a fake transaction-aware repository, one current session, and fictional users. Add executable tests asserting USER/LEADER list scopes, non-ADMIN create rejection, unavailable initial-owner rejection, OWNER/ADMIN lifecycle success, VIEWER lifecycle rejection, hidden project read error, and one audit event plus one revision increment for each successful mutation.

Run: `npm run test -- --run apps/api/src/modules/projects/project-service.test.ts`

Expected: FAIL because `ProjectService` does not exist.

- [ ] **Step 2: Add stable service errors and authorization mapping**

```ts
export type ProjectServiceErrorCode =
  | "PROJECT_NOT_FOUND"
  | "FORBIDDEN"
  | "VALIDATION_ERROR"
  | "INVALID_PROJECT_STATE"
  | "USER_NOT_AVAILABLE"
  | "MEMBER_ALREADY_EXISTS"
  | "LAST_OWNER_REQUIRED";

export class ProjectServiceError extends Error {
  constructor(readonly code: ProjectServiceErrorCode, message: string) {
    super(message);
  }
}
```

Map `AuthorizationDecision` centrally: invalid session/account decisions become authentication errors already handled by M2; hidden read denials become `PROJECT_NOT_FOUND`; mutation denials become `FORBIDDEN`.

- [ ] **Step 3: Implement list, detail, and create**

```ts
async createProject(principal: AuthenticatedPrincipal, input: CreateProjectInput) {
  await this.assertAuthorized(principal, { projectId: null, projectExists: false, memberRole: null }, "PROJECT_CREATE");
  const owner = await this.requireAvailableUser(input.ownerUserId);
  const validation = validateProjectInput(input.project);
  if (!validation.ok) throw new ProjectServiceError("VALIDATION_ERROR", "Project input is invalid");

  return this.repository.transaction(async (transaction) => {
    const commitSequence = await transaction.nextCommitSequence();
    const occurredAt = this.dependencies.now().toISOString();
    const project = await transaction.createProject({
      ...input.project,
      id: this.dependencies.generateId(),
      actorUserId: principal.userId,
      occurredAt,
      commitSequence
    });
    await transaction.addMember({
      id: this.dependencies.generateId(),
      projectId: project.id,
      userId: owner.id,
      memberRole: "OWNER",
      jobTitle: "",
      phone: "",
      remark: "",
      actorUserId: principal.userId,
      occurredAt
    });
    await transaction.writeAudit({
      id: this.dependencies.generateId(),
      projectId: project.id,
      commitSequence,
      eventType: "PROJECT_CREATED",
      actorUserId: principal.userId,
      targetType: "PROJECT",
      targetId: project.id,
      changeSummary: { fields: ["name", "year", "type", "status", "phase", "filingStatus"] },
      occurredAt
    });
    return project;
  });
}
```

Project responses include `permissions: { canEdit, canManageMembers, canChangeLifecycle, canReadAudit }` calculated by invoking M2 authorization actions; they never trust client permission flags.

- [ ] **Step 4: Implement update, archive, restore, and audit read**

Acquire the project row with `lock=true`, authorize using its current member role, obtain one sequence, increment project revision, write a safe event, and commit. Project update summaries may contain non-sensitive old/new project field values; member phone and remark values are never copied into audit summaries.

- [ ] **Step 5: Run focused project workflow tests**

Run: `npm run test -- --run apps/api/src/modules/projects/project-service.test.ts apps/api/src/modules/authorization/authorization-service.test.ts`

Expected: PASS.

- [ ] **Step 6: Manual commit checkpoint**

```bash
git add apps/api/src/modules/projects/project-service-error.ts apps/api/src/modules/projects/project-service.ts apps/api/src/modules/projects/project-service.test.ts
git commit -m "feat: add project application workflows"
```

### Task 5: Complete Member Management Workflows

**Files:**
- Create: `apps/api/src/modules/projects/member-service.ts`
- Create: `apps/api/src/modules/projects/member-service.test.ts`

**Interfaces:**
- Consumes: Task 3 repository, Task 4 service errors, M2 `AuthorizationService`, and `AuthStateStore`.
- Produces: `MemberService.listMembers()`, `searchCandidates()`, `addMember()`, `updateMember()`, and `removeMember()`.

- [ ] **Step 1: Write failing member closure tests**

```ts
it.each([
  ["OWNER", true],
  ["EDITOR", false],
  ["VIEWER", false]
] as const)("maps %s member management permission", async (memberRole, allowed) => {
  const harness = createMemberServiceHarness({
    principalRole: "USER",
    memberRole,
    ownerCount: 2
  });
  const request = harness.service.addMember(
    harness.principal,
    harness.projectId,
    { userId: harness.candidateUserId, memberRole: "VIEWER", jobTitle: "", phone: "", remark: "" }
  );
  if (allowed) {
    await expect(request).resolves.toMatchObject({ memberRole: "VIEWER" });
  } else {
    await expect(request).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
});

it("rejects removing the last owner", async () => {
  const harness = createMemberServiceHarness({ memberRole: "OWNER", ownerCount: 1 });
  await expect(
    harness.service.removeMember(harness.principal, harness.projectId, harness.principalMemberId)
  ).rejects.toMatchObject({ code: "LAST_OWNER_REQUIRED" });
  expect(harness.repository.removedMemberIds).toEqual([]);
});
```

Define `createMemberServiceHarness()` with complete fictional active, disabled, and pending users plus an in-memory repository. Add executable tests asserting project readers can list, two-character candidate search excludes existing/unavailable users and caps at 20, duplicate add maps to `MEMBER_ALREADY_EXISTS`, profile update audit contains changed field names but not phone/remark values, owner demotion is protected, and ADMIN succeeds without membership.

Run: `npm run test -- --run apps/api/src/modules/projects/member-service.test.ts`

Expected: FAIL because `MemberService` does not exist.

- [ ] **Step 2: Implement candidate search against M2 users**

```ts
return this.authStore.read((state) =>
  state.users
    .filter((user) => user.accountStatus === "ACTIVE" && user.credentialStatus === "READY")
    .filter((user) => !existingUserIds.has(user.id))
    .filter((user) => `${user.username} ${user.displayName}`.toLocaleLowerCase().includes(normalizedQuery))
    .slice(0, 20)
    .map(({ id, username, displayName }) => ({ id, username, displayName }))
);
```

Reject queries shorter than two trimmed Unicode code points before reading the user list.

- [ ] **Step 3: Implement member mutations with final owner protection**

For update and delete, lock the project and target membership rows. If the target is `OWNER` and the result removes owner status, run `countOwners()` inside the same transaction and reject when the count is one. Catch the database unique violation for `(project_id, user_id)` and map only that named constraint to `MEMBER_ALREADY_EXISTS`.

- [ ] **Step 4: Ensure every member mutation updates the parent project**

Each add, update, and remove obtains one commit sequence, increments the parent project's `revision`, `updated_at`, `updated_by`, and `commit_sequence`, then writes exactly one member audit event. Audit summaries may contain member role and changed field names, but not phone or remark contents.

- [ ] **Step 5: Run member workflow tests**

Run: `npm run test -- --run apps/api/src/modules/projects/member-service.test.ts`

Expected: PASS.

- [ ] **Step 6: Manual commit checkpoint**

```bash
git add apps/api/src/modules/projects/member-service.ts apps/api/src/modules/projects/member-service.test.ts
git commit -m "feat: complete member management workflows"
```

### Task 6: Expose Project and Member HTTP APIs

**Files:**
- Create: `apps/api/src/modules/projects/schemas.ts`
- Create: `apps/api/src/modules/projects/routes.ts`
- Create: `apps/api/src/modules/projects/http.test.ts`
- Modify: `apps/api/src/modules/auth/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/runtime.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/src/modules/auth/http.test.ts`
- Modify: `apps/api/src/modules/users/http.test.ts`

**Interfaces:**
- Consumes: Task 4 `ProjectService`, Task 5 `MemberService`, M2 authentication helpers, and `ApiConfig`.
- Produces: all `/api/v1/projects` routes in the approved design.

- [ ] **Step 1: Write HTTP contract tests**

Cover exact routes and status codes:

```ts
it("rejects extra project fields before calling the service", async () => {
  const harness = await createProjectsHttpHarness();
  const response = await harness.app.inject({
    method: "PATCH",
    url: `/api/v1/projects/${harness.projectId}`,
    headers: harness.authenticatedHeaders,
    payload: { ...harness.validProjectInput, unsupported: true }
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toEqual({
    code: "VALIDATION_ERROR",
    message: "Invalid request"
  });
  expect(harness.projectService.updateProject).not.toHaveBeenCalled();
  await harness.app.close();
});
```

Define `createProjectsHttpHarness()` with real M2 authentication and typed spies for both project services. Add one executable request/response test for every route in section 7 of the specification, asserting method, path, same-origin enforcement, status code, strict response fields, and service arguments. Use `it.each` to assert each business code maps to its expected `400/403/404/409` response.

Run: `npm run test -- --run apps/api/src/modules/projects/http.test.ts`

Expected: FAIL because the routes are not registered.

- [ ] **Step 2: Create strict Fastify schemas**

Every object schema uses `additionalProperties: false`. Define reusable schemas for UUID params, project input, project response, member response, candidate response, audit response, pagination, and the standard error body. Restrict `pageSize` to 1-100 and candidate results to 20.

```ts
export const projectParamsSchema = {
  type: "object",
  additionalProperties: false,
  required: ["projectId"],
  properties: { projectId: { type: "string", format: "uuid" } }
} as const;
```

- [ ] **Step 3: Register authenticated read and same-origin write routes**

```ts
const principal = await services.authService.authenticate(
  readSessionToken(request, config)
);
assertSameOrigin(request, config); // apply before every POST, PATCH, DELETE
return services.projectService.updateProject(principal, request.params.projectId, request.body);
```

Use response `201` for create/add, `204` for member delete, `200` for all other successful operations.

- [ ] **Step 4: Map project service errors without leaking internals**

Extend `sendApiError()` so validation maps to `400`, hidden project errors to `404`, forbidden to `403`, duplicate/last-owner/state conflicts to `409`, and unknown database errors continue to the generic `500` handler. Never return SQL text, connection strings, stack traces, or auth-store fields.

- [ ] **Step 5: Wire runtime services and pool shutdown**

`createRuntimeServices()` creates the pool and both project services after M2 services. Return a `close(): Promise<void>` callback, and register it with Fastify `onClose` so test and production shutdown release PostgreSQL connections. Do not auto-run migrations during API startup.

- [ ] **Step 6: Run all API tests and typecheck**

Run: `npm run test -- --run apps/api/src/modules/projects/http.test.ts apps/api/src/modules/auth/http.test.ts apps/api/src/modules/users/http.test.ts apps/api/src/app.test.ts`

Run: `npm run typecheck --workspace @project-online/api`

Expected: PASS.

- [ ] **Step 7: Manual commit checkpoint**

```bash
git add apps/api/src/modules/projects/schemas.ts apps/api/src/modules/projects/routes.ts apps/api/src/modules/projects/http.test.ts apps/api/src/modules/auth/routes.ts apps/api/src/app.ts apps/api/src/runtime.ts apps/api/src/server.ts apps/api/src/modules/auth/http.test.ts apps/api/src/modules/users/http.test.ts
git commit -m "feat: expose project and member APIs"
```

### Task 7: Build the Typed Web Project Client

**Files:**
- Create: `apps/web/src/features/projects/projects-client.ts`
- Create: `apps/web/src/features/projects/projects-client.test.ts`

**Interfaces:**
- Consumes: existing `createApiClient()` and Task 1 shared types.
- Produces: `ProjectsClient` with project, member, candidate, lifecycle, and audit methods.

- [ ] **Step 1: Write failing client contract tests**

```ts
it("encodes project filters in GET /projects", async () => {
  const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(projectPageResponse());
  const client = createProjectsClient("/api", fetchImpl);
  await client.listProjects({
    query: "示例项目",
    year: 2026,
    status: "施工中",
    lifecycle: "ACTIVE",
    page: 2,
    pageSize: 20
  });
  expect(fetchImpl).toHaveBeenCalledWith(
    "/api/v1/projects?query=%E7%A4%BA%E4%BE%8B%E9%A1%B9%E7%9B%AE&year=2026&status=%E6%96%BD%E5%B7%A5%E4%B8%AD&lifecycle=ACTIVE&page=2&pageSize=20",
    expect.objectContaining({ credentials: "same-origin" })
  );
});
```

Add executable tests using valid and one-field-corrupted response fixtures for projects, users, members, candidates, and audit pages. Assert `listInitialOwnerCandidates()` requests `/v1/users`, excludes disabled or non-ready users, and returns only candidate fields. Use `it.each` for every mutation method to assert path, HTTP method, JSON body, and headers; use another `it.each` for `401/403/404/409` to assert the original `ApiClientError.status` and `.code` remain unchanged.

Run: `npm run test -- --run apps/web/src/features/projects/projects-client.test.ts`

Expected: FAIL because `projects-client.ts` does not exist.

- [ ] **Step 2: Define the complete client interface**

```ts
export interface ProjectsClient {
  listProjects(filters: ProjectListFilters): Promise<ProjectPage>;
  listInitialOwnerCandidates(): Promise<MemberCandidate[]>;
  createProject(input: CreateProjectInput): Promise<ProjectDetails>;
  getProject(projectId: string): Promise<ProjectDetails>;
  updateProject(projectId: string, input: ProjectInput): Promise<ProjectDetails>;
  archiveProject(projectId: string): Promise<ProjectDetails>;
  restoreProject(projectId: string): Promise<ProjectDetails>;
  listMembers(projectId: string): Promise<ProjectMemberView[]>;
  searchMemberCandidates(projectId: string, query: string): Promise<MemberCandidate[]>;
  addMember(projectId: string, input: AddMemberInput): Promise<ProjectMemberView>;
  updateMember(projectId: string, memberId: string, input: MemberInput): Promise<ProjectMemberView>;
  removeMember(projectId: string, memberId: string): Promise<void>;
  listAuditEvents(projectId: string, page: number): Promise<ProjectAuditPage>;
}
```

- [ ] **Step 3: Implement response guards and requests**

Use one `readJson()` helper local to the feature, strict guards for every response, `encodeURIComponent()` for path IDs, and `URLSearchParams` for filters. `listInitialOwnerCandidates()` calls the existing ADMIN-only `GET /v1/users`, retains only `ACTIVE/READY` users, and maps them to `{ id, username, displayName }`; it does not add another global user endpoint. Do not store responses or credentials in Web Storage.

- [ ] **Step 4: Run client tests**

Run: `npm run test -- --run apps/web/src/features/projects/projects-client.test.ts`

Expected: PASS.

- [ ] **Step 5: Manual commit checkpoint**

```bash
git add apps/web/src/features/projects/projects-client.ts apps/web/src/features/projects/projects-client.test.ts
git commit -m "feat: add typed projects web client"
```

### Task 8: Deliver Project List and Editor UI

**Files:**
- Create: `apps/web/src/features/projects/ProjectsView.tsx`
- Create: `apps/web/src/features/projects/ProjectListView.tsx`
- Create: `apps/web/src/features/projects/ProjectEditorDialog.tsx`
- Create: `apps/web/src/features/projects/ProjectListView.test.tsx`
- Create: `apps/web/src/features/projects/ProjectEditorDialog.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 7 `ProjectsClient` and current authenticated `SessionUser`.
- Produces: authenticated project workspace, URL-backed list filters, project creation, and project edit forms.

- [ ] **Step 1: Write failing list and editor interaction tests**

```tsx
it("shows create only to ADMIN", async () => {
  const client = createProjectsClientStub({ page: emptyProjectPage() });
  const { rerender } = render(
    <ProjectListView sessionRole="USER" client={client} onOpenProject={vi.fn()} />
  );
  expect(await screen.findByText("暂无项目")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "新建项目" })).not.toBeInTheDocument();
  rerender(
    <ProjectListView sessionRole="ADMIN" client={client} onOpenProject={vi.fn()} />
  );
  expect(screen.getByRole("button", { name: "新建项目" })).toBeInTheDocument();
});
```

Define `createProjectsClientStub()` and complete project/page fixtures in the test file. Add executable tests that resolve or reject the stub promises to assert loading, empty, filtered, validation, network, and `401` states; assert `window.location.search` after each filter interaction; and hold a create/update promise unresolved to verify duplicate submit is disabled until completion.

Run: `npm run test -- --run apps/web/src/features/projects/ProjectListView.test.tsx apps/web/src/features/projects/ProjectEditorDialog.test.tsx apps/web/src/App.test.tsx`

Expected: FAIL because the project workspace is absent.

- [ ] **Step 2: Implement URL-backed filters without a router dependency**

```ts
function readFilters(search: string): ProjectListFilters {
  const params = new URLSearchParams(search);
  return {
    query: params.get("query") ?? "",
    year: params.get("year") ? Number(params.get("year")) : undefined,
    status: parseProjectStatus(params.get("status")),
    lifecycle: parseLifecycle(params.get("lifecycle")),
    page: Math.max(1, Number(params.get("page") ?? 1)),
    pageSize: 20
  };
}
```

Update filters with `history.replaceState` and listen for `popstate`. Do not add `react-router` for this milestone.

- [ ] **Step 3: Build the list and create/edit form**

The table shows name, year, type, status, phase, owner display name, updated time, and lifecycle. On narrow screens render the same fields as cards through CSS, not a duplicate component tree.

The editor contains only M3 project fields. When an ADMIN opens create mode, load `listInitialOwnerCandidates()` once and require one initial owner selection; edit mode does not request the global user list. Client-side validation mirrors Task 1; server errors remain authoritative.

- [ ] **Step 4: Integrate projects into the authenticated App shell**

Make projects the default authenticated view. Keep account/password and administrator user management accessible from a small navigation control. Pass the existing `onSessionExpired` callback into `ProjectsView`.

- [ ] **Step 5: Run list, editor, and App tests**

Run: `npm run test -- --run apps/web/src/features/projects/ProjectListView.test.tsx apps/web/src/features/projects/ProjectEditorDialog.test.tsx apps/web/src/App.test.tsx`

Expected: PASS.

- [ ] **Step 6: Manual commit checkpoint**

```bash
git add apps/web/src/features/projects/ProjectsView.tsx apps/web/src/features/projects/ProjectListView.tsx apps/web/src/features/projects/ProjectEditorDialog.tsx apps/web/src/features/projects/ProjectListView.test.tsx apps/web/src/features/projects/ProjectEditorDialog.test.tsx apps/web/src/App.tsx apps/web/src/App.test.tsx apps/web/src/styles.css
git commit -m "feat: add project list and editor UI"
```

### Task 9: Deliver Project Detail, Lifecycle, and Audit UI

**Files:**
- Create: `apps/web/src/features/projects/ProjectDetailView.tsx`
- Create: `apps/web/src/features/projects/ProjectDetailView.test.tsx`
- Modify: `apps/web/src/features/projects/ProjectsView.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 7 client and API-provided `ProjectPermissions`.
- Produces: detail navigation, edit entry, archive/restore confirmation, and read-only audit timeline.

- [ ] **Step 1: Write failing detail and lifecycle tests**

```tsx
it("renders actions from server permission flags", async () => {
  const client = createProjectsClientStub({
    details: projectDetails({
      canEdit: false,
      canManageMembers: true,
      canChangeLifecycle: false,
      canReadAudit: true
    })
  });
  render(<ProjectDetailView projectId={projectId} client={client} onBack={vi.fn()} />);
  expect(await screen.findByRole("heading", { name: "示例-项目详情" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "编辑项目" })).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "项目成员" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "归档项目" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看审计记录" })).toBeInTheDocument();
});
```

Add executable tests that click a list row and assert the requested project ID, confirm archive and restore dialogs before checking the returned lifecycle, open audit and append a second page, and use rejected client promises for `403`, `404`, and network retry behavior.

Run: `npm run test -- --run apps/web/src/features/projects/ProjectDetailView.test.tsx`

Expected: FAIL because `ProjectDetailView` does not exist.

- [ ] **Step 2: Implement detail and server-driven actions**

Never infer edit/member/audit permission from the session role in the component. Render controls only from `details.permissions` returned by the server. Confirm archive/restore in an accessible dialog and disable the action while the command is running.

- [ ] **Step 3: Implement audit timeline**

Render event type, actor display label, server time, commit sequence, and safe summary. Fetch the first page on opening the audit panel and provide an explicit “加载更多” button when another page exists; do not auto-poll.

- [ ] **Step 4: Run detail tests**

Run: `npm run test -- --run apps/web/src/features/projects/ProjectDetailView.test.tsx`

Expected: PASS.

- [ ] **Step 5: Manual commit checkpoint**

```bash
git add apps/web/src/features/projects/ProjectDetailView.tsx apps/web/src/features/projects/ProjectDetailView.test.tsx apps/web/src/features/projects/ProjectsView.tsx apps/web/src/styles.css
git commit -m "feat: add project detail and audit UI"
```

### Task 10: Deliver Complete Member Management UI

**Files:**
- Create: `apps/web/src/features/projects/ProjectMembersPanel.tsx`
- Create: `apps/web/src/features/projects/ProjectMembersPanel.test.tsx`
- Modify: `apps/web/src/features/projects/ProjectDetailView.tsx`
- Modify: `apps/web/src/features/projects/ProjectsView.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Consumes: Task 7 member client methods and server-provided `canManageMembers`.
- Produces: member list, candidate search, add, role/profile edit, remove, and last-owner feedback.

- [ ] **Step 1: Write failing member closure UI tests**

```tsx
it("disables destructive actions for the only owner", async () => {
  const client = createProjectsClientStub({ members: [ownerMember()] });
  render(
    <ProjectMembersPanel
      projectId={projectId}
      canManageMembers
      client={client}
      onChanged={vi.fn()}
    />
  );
  expect(await screen.findByText("示例负责人")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "管理示例负责人" }));
  expect(screen.getByRole("button", { name: "移除成员" })).toBeDisabled();
  expect(screen.getByRole("option", { name: "协作编辑" })).toBeDisabled();
});
```

Define complete active and disabled member fixtures plus candidate fixtures. Add executable tests for read-only rendering, the two-character search threshold, selected-candidate add request, all editable member fields, confirmed removal, `onChanged` refresh callback, and a rejected `LAST_OWNER_REQUIRED` request rendering the required Chinese message.

Run: `npm run test -- --run apps/web/src/features/projects/ProjectMembersPanel.test.tsx`

Expected: FAIL because `ProjectMembersPanel` does not exist.

- [ ] **Step 2: Implement read-only member rendering**

Show display name, username, member role, job title, phone, remark, and current account status. Disabled accounts remain visible with a clear “已停用” label.

- [ ] **Step 3: Implement candidate search and add flow**

Start search only after two trimmed characters. Ignore responses from superseded searches with an incrementing request ID. Require candidate and role selection, disable duplicate submission, and clear the form only after success.

- [ ] **Step 4: Implement edit and remove flows**

Use one accessible dialog for role/profile editing and one confirmation dialog for removal. Disable owner demotion/removal when the loaded member list has exactly one `OWNER`; still map server `LAST_OWNER_REQUIRED` to “项目必须保留至少一名负责人”.

- [ ] **Step 5: Refresh the complete project state after mutation**

After add, update, or remove succeeds, reload members and project details; if the audit panel is open, reload its first page. This ensures permission changes such as self-demotion are reflected immediately.

- [ ] **Step 6: Run member UI and detail tests**

Run: `npm run test -- --run apps/web/src/features/projects/ProjectMembersPanel.test.tsx apps/web/src/features/projects/ProjectDetailView.test.tsx`

Expected: PASS.

- [ ] **Step 7: Manual commit checkpoint**

```bash
git add apps/web/src/features/projects/ProjectMembersPanel.tsx apps/web/src/features/projects/ProjectMembersPanel.test.tsx apps/web/src/features/projects/ProjectDetailView.tsx apps/web/src/features/projects/ProjectsView.tsx apps/web/src/styles.css
git commit -m "feat: complete member management UI"
```

### Task 11: Add Fictional Seed, CI Database Verification, and Final Validation

**Files:**
- Create: `apps/api/src/database/seed-fictional.ts`
- Create: `apps/api/src/database/seed-fictional.test.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `.github/workflows/verify.yml`
- Modify: `README.md`
- Modify: `TO-do.md`

**Interfaces:**
- Consumes: explicit database URL, existing fictional M2 users, migration runner, and all M3 modules.
- Produces: `db:seed:fictional`, CI PostgreSQL verification, and documented local M3 workflow.

- [ ] **Step 1: Write the failing fictional seed test**

```ts
it("refuses to run without an explicit confirmation flag", async () => {
  await expect(
    seedFictionalData({
      confirmation: undefined,
      adminUserId,
      ownerUserId,
      repository
    })
  ).rejects.toThrow("SEED_FICTIONAL_DATA=yes is required");
  expect(repository.createdProjects).toEqual([]);
});

it("uses only the supplied fictional users and example-prefixed projects", async () => {
  await seedFictionalData({
    confirmation: "yes",
    adminUserId,
    ownerUserId,
    repository
  });
  expect(repository.createdProjects.every(({ name }) => name.startsWith("示例-"))).toBe(true);
  expect(repository.createdMemberUserIds).toEqual([ownerUserId]);
});
```

Inject the repository and user IDs into `seedFictionalData()` so unit tests require no filesystem reads. Add a spy on `node:fs/promises.readFile` and assert it is never called by the seed function; the CLI may read only environment variables and command arguments.

Run: `npm run test -- --run apps/api/src/database/seed-fictional.test.ts`

Expected: FAIL because the seed command does not exist.

- [ ] **Step 2: Implement an explicit, idempotent fictional seed command**

Require `SEED_FICTIONAL_DATA=yes` and explicit fictional user IDs supplied through command arguments. Use fixed UUIDs in a reserved documented test namespace, names prefixed with `示例-`, and repository/service methods rather than duplicating SQL. Never inspect the legacy project directory.

Add scripts:

```json
{
  "db:seed:fictional": "npm run db:seed:fictional --workspace @project-online/api"
}
```

- [ ] **Step 3: Add PostgreSQL to GitHub Actions**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_USER: project_online_test
      POSTGRES_PASSWORD: test-only-password
      POSTGRES_DB: project_online_test
    ports:
      - 5432:5432
    options: >-
      --health-cmd "pg_isready -U project_online_test"
      --health-interval 5s
      --health-timeout 5s
      --health-retries 10
```

Set CI-only `DATABASE_URL` and `TEST_DATABASE_URL`, run `npm run db:migrate`, then `npm run test:db`, then the existing lint, format, typecheck, unit tests, and build steps.

- [ ] **Step 4: Document exact local workflow and M3 completion**

Document:

```bash
cp .env.example .env
docker compose up -d postgres
npm run db:migrate
npm run bootstrap-admin
npm run dev
```

State clearly that `.env` credentials must be chosen locally, migrations create empty M3 tables, and no legacy data migration occurs. Mark only the completed M3 checklist items in `TO-do.md`; do not modify future milestone scope.

- [ ] **Step 5: Run the full verification ladder**

Run:

```bash
npm run test -- --run packages/domain/src/projects/validation.test.ts
npm run test -- --run apps/api/src/modules/projects apps/web/src/features/projects
npm run test:db
npm run lint
npm run format:check
npm run typecheck
npm run test -- --run
npm run build
```

Expected: every command exits 0. Confirm test logs contain only fictional data and no credentials, SQL connection strings, or legacy project contents.

- [ ] **Step 6: Perform browser acceptance with fictional data**

Verify desktop and narrow mobile widths:

1. `USER` sees only joined projects.
2. `LEADER` sees all projects but cannot edit without `OWNER/EDITOR` membership.
3. `ADMIN` creates a project with an initial owner.
4. `OWNER` adds a member, changes the role, edits member details, and removes the member.
5. The only owner cannot be demoted or removed.
6. Authorized users edit, archive, restore, and read audit history.
7. Loading, success, validation, forbidden, hidden, and network failure states are visible and recoverable.

- [ ] **Step 7: Manual commit checkpoint**

```bash
git add apps/api/src/database/seed-fictional.ts apps/api/src/database/seed-fictional.test.ts apps/api/package.json package.json .github/workflows/verify.yml README.md TO-do.md
git commit -m "test: complete M3 project management verification"
```
