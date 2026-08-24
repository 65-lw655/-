# M5 Project Sync Vertical Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-backed, idempotent push/pull synchronization slice for `PROJECT` records without connecting the desktop sync loop.

**Architecture:** Keep PostgreSQL project writes in the existing project repository/service boundary. Add transaction-owned sync operation results and an append-only project change log beside the projects table. Expose typed protocol contracts from `packages/sync`, and register `/api/v1/sync/push` and `/api/v1/sync/pull` through a narrow `SyncService` that reuses authentication and project authorization.

**Tech Stack:** TypeScript, Fastify, PostgreSQL/`pg`, Vitest, existing domain validation and authorization services.

**Spec:** `docs/architecture/sync-protocol.md`

## Global Constraints

- This slice supports `PROJECT` only; do not add contract, receipt, file, calendar, Todo, or desktop sync-loop behavior.
- Push batches contain at most 100 operations and pull pages at most 500 changes.
- Repeating an `operationId` returns the stored original result and never writes a second project/change row.
- Every accepted push writes the project, operation result, project change log, and audit event in one PostgreSQL transaction.
- Server-managed fields (`createdBy`, `updatedBy`, `commitSequence`, server timestamps) are never accepted from payloads.
- Pull returns only projects the authenticated principal can currently read; cursor advances only with a complete ordered page.
- Tests use the existing isolated PostgreSQL schema helper; do not access any existing database.

---

### Task 1: Freeze shared sync protocol contracts

**Files:**
- Modify: `packages/sync/src/index.ts`
- Create: `packages/sync/src/protocol/project-sync.ts`
- Create: `packages/sync/src/protocol/project-sync.test.ts`
- Modify: `packages/sync/package.json`

**Interfaces:**
- Produces `ProjectSyncOperation`, `PushProjectsRequest`, `PushProjectResult`, `PullProjectsQuery`, `ProjectChange`, and `PullProjectsResponse` types plus runtime validators/constants used by the API.

- [ ] Write failing tests for valid `PROJECT` UPSERT/DELETE envelopes, UUID fields, protocol version `1`, max batch/page limits, and rejection of server-managed payload fields.
- [ ] Run the focused sync tests and confirm they fail because the protocol module is missing.
- [ ] Implement the smallest typed protocol module and package export.
- [ ] Run `npm run test -- --run packages/sync/src/protocol/project-sync.test.ts` and package typecheck.
- [ ] Commit: `feat: define project sync protocol contracts`.

### Task 2: Add PostgreSQL sync result and project change migrations

**Files:**
- Create: `apps/api/src/database/migrations/002_project_sync.sql`
- Create: `apps/api/src/database/migrations/002_project_sync.test.ts`

**Interfaces:**
- Creates `sync_operation_results` keyed by `(device_id, operation_id)`, storing the immutable result JSON and status.
- Creates `project_change_log` keyed by `commit_sequence`, storing project/entity identifiers, revision, deletion state, visible project JSON, and actor.

- [ ] Write failing isolated-database tests for migration creation, uniqueness, commit sequence ordering, and operation-result lookup.
- [ ] Run the migration tests and confirm the new tables do not exist before implementation.
- [ ] Add the append-only tables, indexes for operation lookup and project/cursor pull, and foreign keys to `projects` where safe.
- [ ] Run migration idempotency and rollback-focused tests using `withTestDatabase`.
- [ ] Commit: `feat: add project sync persistence tables`.

### Task 3: Implement transactional PROJECT push service

**Files:**
- Create: `apps/api/src/modules/sync/sync-repository.ts`
- Create: `apps/api/src/modules/sync/sync-service.ts`
- Create: `apps/api/src/modules/sync/sync-service.test.ts`
- Modify: `apps/api/src/modules/projects/project-repository.ts`
- Modify: `apps/api/src/modules/projects/postgres-project-repository.ts`

**Interfaces:**
- `SyncService.pushProjects(principal, request): Promise<PushProjectsResponse>`.
- Repository transaction methods for operation-result lookup/write, project access, project update/delete, change-log append, and audit append.

- [ ] Write failing service tests for accepted UPSERT, idempotent duplicate, FORBIDDEN, VALIDATION_FAILED, NOT_FOUND, stale `baseRevision` with `conflict: true`, and independent per-operation results.
- [ ] Run focused tests against an isolated PostgreSQL schema and confirm they fail before service/repository methods exist.
- [ ] Implement one transaction per operation: authenticate/authorize, validate payload, lock project, allocate the existing commit sequence, write project + audit + change log + immutable operation result, then return the stored result.
- [ ] Ensure duplicate lookup happens before mutation and returns the original result byte-for-byte.
- [ ] Run service tests, existing project tests, and typecheck.
- [ ] Commit: `feat: accept idempotent project sync operations`.

### Task 4: Implement cursor-based PROJECT pull service

**Files:**
- Modify: `apps/api/src/modules/sync/sync-repository.ts`
- Modify: `apps/api/src/modules/sync/sync-service.ts`
- Create: `apps/api/src/modules/sync/sync-pull.test.ts`

**Interfaces:**
- `SyncService.pullProjects(principal, query): Promise<PullProjectsResponse>`.

- [ ] Write failing tests for ordered `after` cursor paging, `limit` validation, `hasMore`, next cursor, and exclusion of projects no longer readable by the principal.
- [ ] Run focused pull tests and confirm failure before implementation.
- [ ] Implement change-log reads joined to current authorization scope; return only visible project fields and deletion state.
- [ ] Ensure empty pages preserve the input cursor and do not advance it.
- [ ] Run pull tests and project authorization regression tests.
- [ ] Commit: `feat: pull authorized project changes by cursor`.

### Task 5: Register sync HTTP routes and runtime wiring

**Files:**
- Create: `apps/api/src/modules/sync/routes.ts`
- Create: `apps/api/src/modules/sync/schemas.ts`
- Modify: `apps/api/src/modules/auth/routes.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/runtime.ts`
- Create: `apps/api/src/modules/sync/http.test.ts`

**Interfaces:**
- `POST /api/v1/sync/push` with authenticated session and `PushProjectsRequest` JSON body.
- `GET /api/v1/sync/pull?after=<integer>&limit=<integer>` with authenticated session.

- [ ] Write failing HTTP tests for 401, 400 validation, accepted push, duplicate push, pull pagination, and mapped service errors.
- [ ] Run focused HTTP tests and confirm failure before route registration.
- [ ] Add Fastify schemas with additional-properties rejection and register a `SyncApiService` on `ApiServices`.
- [ ] Wire the runtime service to the existing pool, project repository, authorization service, and auth store without creating a second pool.
- [ ] Run all API tests, typecheck, and API artifact smoke.
- [ ] Commit: `feat: expose project sync push and pull endpoints`.

### Task 6: End-to-end isolated acceptance and documentation

**Files:**
- Modify: `apps/api/src/modules/sync/http.test.ts`
- Modify: `docs/architecture/sync-protocol.md`
- Modify: `README.md`
- Modify: `TO-do.md`

- [ ] Add an isolated PostgreSQL acceptance test covering push success, lost response/retry duplicate, pull after cursor, and forbidden access after membership removal.
- [ ] Run `npm run verify`, API integration tests with the isolated test database, and `git diff --check`.
- [ ] Document that M5.1 supports PROJECT push/pull only and that desktop automatic sync remains out of scope.
- [ ] Mark only the completed M5.1 checklist items; leave conflicts, permissions revocation UI, files, and desktop sync loop for later tasks.
- [ ] Commit: `test: verify project sync vertical slice`.

## Verification Commands

```bash
npm run verify
npm run test:db
npm run typecheck --workspaces --if-present
git diff --check
```
