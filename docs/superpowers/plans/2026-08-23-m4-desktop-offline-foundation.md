# M4 Desktop Offline Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build macOS and Windows Tauri clients that can open, view, and edit locally cached projects without a network connection while atomically recording every edit in a SQLite Outbox.

**Architecture:** Shared React project views depend on a narrow `ProjectRepository`; Web injects the existing M3 HTTP adapter and Desktop injects a Tauri adapter. Rust owns the SQLite connection, migrations, project-update transaction, and operating-system credential store so the frontend cannot execute arbitrary SQL or persist secrets.

**Tech Stack:** Tauri 2, Rust stable, React 19, TypeScript 6, Vite 8, Vitest 4, rusqlite with bundled SQLite, serde, uuid, keyring, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-08-23-m4-desktop-offline-foundation-design.md`

## Global Constraints

- M4 covers project list, project detail, and project edit only; project creation, lifecycle changes, members, and audit remain Web-only.
- M4 generates Outbox rows but does not push, pull, retry, resolve conflicts, or process permission revocations.
- SQLite is accessed only by narrow Rust commands; the frontend never receives a generic SQL command.
- A local project edit, its Outbox row, and the client-sequence increment commit in one SQLite transaction or all roll back.
- Credentials are stored only in macOS Keychain Services or Windows Credential Manager; no plaintext fallback is permitted.
- Windows capabilities and artifacts contain no calendar, reminders, Microsoft To Do, or task-system integration.
- Tests use temporary SQLite files and in-memory credential doubles; they never query an existing database or real credential store.
- Every behavior change follows red-green-refactor, limits edits to the named files, and ends in an independent commit.

---

## File Structure

### Shared UI and repository contract

- `packages/ui/src/projects/repository.ts`: narrow repository contract and shared result/error types.
- `packages/ui/src/projects/ProjectListView.tsx`: platform-neutral list and filters.
- `packages/ui/src/projects/ProjectDetailView.tsx`: platform-neutral cached detail and edit entry.
- `packages/ui/src/projects/ProjectEditorDialog.tsx`: edit-only shared form.
- `packages/ui/src/projects/*.test.tsx`: shared component behavior.
- `packages/ui/src/index.ts`: public exports.

### Web adapter

- `apps/web/src/features/projects/online-project-repository.ts`: adapts the existing `ProjectsClient` to the narrow contract.
- `apps/web/src/features/projects/ProjectsView.tsx`: injects the online adapter while retaining Web-only creation.
- `apps/web/src/features/projects/ProjectDetailView.tsx`: composes shared detail with Web-only lifecycle, members, and audit.

### Desktop TypeScript

- `apps/desktop/index.html`, `vite.config.ts`, `src/main.tsx`: Vite/React desktop entry.
- `apps/desktop/src/app/DesktopApp.tsx`: initializes local state and routes list/detail/edit.
- `apps/desktop/src/platform/desktop-bridge.ts`: typed Tauri invocation boundary.
- `apps/desktop/src/repository/local-project-repository.ts`: `ProjectRepository` adapter.
- `apps/desktop/src/features/sync-status/SyncStatus.tsx`: offline and pending-count presentation.
- `apps/desktop/src/**/*.test.tsx`: bridge, adapter, and composition tests.

### Desktop Rust

- `apps/desktop/src-tauri/src/local_db/`: SQLite open, migration, mapping, seed, query, and transaction code.
- `apps/desktop/src-tauri/migrations/001_m4_foundation.sql`: initial local schema.
- `apps/desktop/src-tauri/src/commands/`: narrow project, status, development-seed, and credential commands.
- `apps/desktop/src-tauri/src/credential/`: system credential adapter plus in-memory test double.
- `apps/desktop/src-tauri/capabilities/default.json`: minimum Tauri permissions.
- `apps/desktop/src-tauri/tauri.conf.json`: desktop identity, build paths, windows, and bundles.

---

### Task 1: Scaffold the Tauri 2 desktop application with minimum permissions

**Files:**

- Modify: `apps/desktop/package.json`
- Modify: `apps/desktop/tsconfig.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `eslint.config.js`
- Create: `apps/desktop/index.html`
- Create: `apps/desktop/vite.config.ts`
- Create: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/app/DesktopApp.tsx`
- Create: `apps/desktop/src/app/DesktopApp.test.tsx`
- Create: `apps/desktop/src-tauri/Cargo.toml`
- Create: `apps/desktop/src-tauri/Cargo.lock`
- Create: `apps/desktop/src-tauri/build.rs`
- Create: `apps/desktop/src-tauri/tauri.conf.json`
- Create: `apps/desktop/src-tauri/capabilities/default.json`
- Create: `apps/desktop/src-tauri/src/main.rs`
- Create: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src-tauri/tests/capabilities.rs`

**Interfaces:**

- Produces: desktop scripts `dev`, `typecheck`, `test`, `build:web`, `tauri`, `test:rust`, and `build:desktop`.
- Produces: a Tauri library entry `project_online_desktop_lib::run()`.
- Consumes: `SYSTEM_VERSION` from `@project-online/domain`.

- [ ] **Step 1: Write the failing desktop shell test**

Create `apps/desktop/src/app/DesktopApp.test.tsx`:

```tsx
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DesktopApp } from "./DesktopApp.js";

describe("DesktopApp", () => {
  it("renders the local desktop entry without checking network state", () => {
    render(<DesktopApp />);
    expect(screen.getByRole("heading", { name: "本机项目" })).toBeVisible();
    expect(screen.getByText("正在准备本地数据")).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the test and verify the missing component failure**

Run:

```bash
npm run test -- --run apps/desktop/src/app/DesktopApp.test.tsx
```

Expected: FAIL because `DesktopApp.tsx` does not exist.

- [ ] **Step 3: Add the React/Vite desktop entry and workspace dependencies**

Add React, React DOM, `@project-online/domain`, `@project-online/ui`, `@tauri-apps/api`, Vite, the React plugin, and Tauri CLI to `apps/desktop/package.json`. Set scripts to:

```json
{
  "dev": "vite --host 127.0.0.1",
  "typecheck": "tsc --noEmit",
  "test": "vitest --run src",
  "build:web": "vite build",
  "build": "vite build",
  "tauri": "tauri",
  "test:rust": "cargo test --locked --manifest-path src-tauri/Cargo.toml",
  "build:desktop": "tauri build --debug --no-bundle"
}
```

Configure `tsconfig.json` with DOM libraries, React JSX, and `src/**/*.tsx`. Configure Vite with `root` equal to `apps/desktop`, fixed port `1420`, strict port selection, and `clearScreen: false`.

Implement the minimum component:

```tsx
export function DesktopApp() {
  return (
    <main>
      <h1>本机项目</h1>
      <p>正在准备本地数据</p>
    </main>
  );
}
```

- [ ] **Step 4: Add a minimum Tauri 2 Rust shell**

Use `tauri-build = "2"` and `tauri = "2"`. Configure application identifier `cn.projectonline.desktop`, one window labeled `main`, `frontendDist` as `../dist`, and `devUrl` as `http://127.0.0.1:1420`.

`src-tauri/capabilities/default.json` must contain only core window/event permissions needed by the main window; it must not contain `shell`, `fs`, `sql`, `calendar`, `reminder`, `todo`, or `task` permissions.

`src-tauri/src/lib.rs`:

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run desktop application");
}
```

- [ ] **Step 5: Add the permission regression test**

Create `apps/desktop/src-tauri/tests/capabilities.rs` and parse `capabilities/default.json`. Assert that its lowercase serialized content does not contain `shell`, `sql`, `calendar`, `reminder`, `todo`, `microsoft`, or `task`.

- [ ] **Step 6: Run focused verification**

Run:

```bash
npm run test -- --run apps/desktop/src/app/DesktopApp.test.tsx
npm run typecheck --workspace @project-online/desktop
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
npm run build:web --workspace @project-online/desktop
```

Expected: all commands PASS and the capability test reports no forbidden permission.

- [ ] **Step 7: Commit the desktop shell**

```bash
git add package.json package-lock.json eslint.config.js apps/desktop
git commit -m "feat: scaffold M4 Tauri desktop shell"
```

---

### Task 2: Extract the shared project repository contract and edit-only UI

**Files:**

- Modify: `packages/ui/package.json`
- Modify: `packages/ui/tsconfig.json`
- Modify: `packages/ui/src/index.ts`
- Create: `packages/ui/src/projects/repository.ts`
- Create: `packages/ui/src/projects/ProjectListView.tsx`
- Create: `packages/ui/src/projects/ProjectListView.test.tsx`
- Create: `packages/ui/src/projects/ProjectDetailView.tsx`
- Create: `packages/ui/src/projects/ProjectDetailView.test.tsx`
- Create: `packages/ui/src/projects/ProjectEditorDialog.tsx`
- Create: `packages/ui/src/projects/ProjectEditorDialog.test.tsx`
- Modify: `apps/web/src/features/projects/ProjectListView.tsx`
- Modify: `apps/web/src/features/projects/ProjectDetailView.tsx`
- Modify: `apps/web/src/features/projects/ProjectEditorDialog.tsx`

**Interfaces:**

- Produces: `ProjectRepository.listProjects`, `getProject`, and `updateProject`.
- Produces: `ProjectRepositoryError` with codes `AUTHENTICATION_REQUIRED`, `PROJECT_FORBIDDEN`, `PROJECT_NOT_FOUND`, `VALIDATION_FAILED`, and `UNAVAILABLE`.
- Produces: shared edit-only components that contain no imports from `apps/web`.
- Consumes: `ProjectInput`, `ProjectListFilters`, `ProjectPermissions`, and `ProjectRecord` from `@project-online/domain`.

- [ ] **Step 1: Write the failing repository contract type test**

Create `packages/ui/src/projects/repository.test.ts` with a compile-time implementation and runtime smoke assertion:

```ts
import { describe, expect, it } from "vitest";
import type { ProjectRepository } from "./repository.js";

describe("ProjectRepository", () => {
  it("exposes only list, detail, and update to shared offline UI", () => {
    const methods: ReadonlyArray<keyof ProjectRepository> = [
      "listProjects",
      "getProject",
      "updateProject"
    ];
    expect(methods).toEqual(["listProjects", "getProject", "updateProject"]);
  });
});
```

Run it and expect failure because `repository.ts` is missing.

- [ ] **Step 2: Implement shared repository types**

Define:

```ts
export interface ProjectListItem {
  project: ProjectRecord;
  ownerLabels: string[];
  syncState?: "SYNCED" | "PENDING";
}

export interface ProjectPage {
  items: ProjectListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProjectDetails {
  project: ProjectRecord;
  permissions: ProjectPermissions;
  syncState?: "SYNCED" | "PENDING";
}

export interface ProjectRepository {
  listProjects(filters: ProjectListFilters): Promise<ProjectPage>;
  getProject(projectId: string): Promise<ProjectDetails>;
  updateProject(projectId: string, input: ProjectInput): Promise<ProjectDetails>;
}
```

Implement `ProjectRepositoryError` without HTTP status assumptions so both adapters can map platform errors consistently.

- [ ] **Step 3: Write failing shared component tests**

Cover these exact behaviors with repository fakes:

- list loads projects and opens the selected ID;
- local `PENDING` badge appears only when `syncState` is `PENDING`;
- detail displays cached fields and enables edit only when `canEdit` is true;
- edit validates through `validateProjectInput`, invokes `updateProject` once, and refreshes with returned details;
- edit maps `PROJECT_FORBIDDEN` and `VALIDATION_FAILED` without treating offline status as failure.

Run:

```bash
npm run test -- --run packages/ui/src/projects
```

Expected: FAIL because the shared components do not exist.

- [ ] **Step 4: Extract only platform-neutral UI**

Copy the M3 field labels, filter controls, detail fields, focus management, and edit form into `packages/ui`. Replace `ProjectsClient` with `ProjectRepository`; replace `ApiClientError` checks with `ProjectRepositoryError` codes. Do not move creation owner selection, lifecycle actions, member panel, or audit timeline.

The shared list must receive filter state through props or an injected `ProjectFilterLocation` adapter. Keep `window.history` behavior in the Web wrapper so the shared component works inside Tauri without browser URL coupling.

- [ ] **Step 5: Recompose Web-only behavior around shared primitives**

Keep the current exported Web component names so existing `App` imports remain stable. The Web detail wrapper renders the shared detail section and continues to own lifecycle actions, members, and audit. The Web editor keeps create mode locally and delegates edit mode to the shared editor.

- [ ] **Step 6: Run regression verification**

Run:

```bash
npm run test -- --run packages/ui/src/projects apps/web/src/features/projects
npm run typecheck --workspace @project-online/ui
npm run typecheck --workspace @project-online/web
npm run build --workspace @project-online/web
```

Expected: all shared tests and all existing M3 Web project tests PASS without snapshot weakening.

- [ ] **Step 7: Commit the shared UI boundary**

```bash
git add packages/ui apps/web/src/features/projects package-lock.json
git commit -m "refactor: share project read and edit UI"
```

---

### Task 3: Add the online repository adapter without changing Web behavior

**Files:**

- Create: `apps/web/src/features/projects/online-project-repository.ts`
- Create: `apps/web/src/features/projects/online-project-repository.test.ts`
- Modify: `apps/web/src/features/projects/ProjectsView.tsx`
- Modify: `apps/web/src/features/projects/projects-client.ts`

**Interfaces:**

- Consumes: existing `ProjectsClient` and shared `ProjectRepository`.
- Produces: `createOnlineProjectRepository(client): ProjectRepository`.
- Preserves: current M3 HTTP validation, session-expiry behavior, Web creation, lifecycle, member, and audit actions.

- [ ] **Step 1: Write failing adapter tests**

Create a fake `ProjectsClient` and assert:

```ts
const repository = createOnlineProjectRepository(client);
await repository.listProjects(filters);
await repository.getProject(projectId);
await repository.updateProject(projectId, input);
```

Verify each call forwards once, owner display names become `ownerLabels`, and `new ApiClientError(401, "SESSION_EXPIRED", "会话已过期")` maps to `ProjectRepositoryError("AUTHENTICATION_REQUIRED")`.

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
npm run test -- --run apps/web/src/features/projects/online-project-repository.test.ts
```

Expected: FAIL because `createOnlineProjectRepository` is missing.

- [ ] **Step 3: Implement the minimal adapter**

The adapter must not duplicate response parsing. It calls the already validated `ProjectsClient`, converts only owner labels, and maps known API errors to shared error codes. Unknown errors become `UNAVAILABLE` with the existing user-safe message.

- [ ] **Step 4: Inject the adapter into shared views**

Create the full `ProjectsClient` once in `ProjectsView`; derive the narrow repository with `useMemo`. Pass the full client only to Web-only creation, lifecycle, member, and audit components.

- [ ] **Step 5: Run Web regression tests**

Run:

```bash
npm run test -- --run apps/web/src/App.test.tsx apps/web/src/features/projects
npm run typecheck --workspace @project-online/web
npm run build --workspace @project-online/web
```

Expected: all existing M3 flows remain green.

- [ ] **Step 6: Commit the online adapter**

```bash
git add apps/web/src/features/projects
git commit -m "refactor: adapt M3 projects to shared repository"
```

---

### Task 4: Implement versioned SQLite initialization and device state

**Files:**

- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.lock`
- Create: `apps/desktop/src-tauri/migrations/001_m4_foundation.sql`
- Create: `apps/desktop/src-tauri/src/local_db/mod.rs`
- Create: `apps/desktop/src-tauri/src/local_db/migrations.rs`
- Create: `apps/desktop/src-tauri/src/local_db/models.rs`
- Create: `apps/desktop/src-tauri/src/local_db/tests.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`

**Interfaces:**

- Produces: `LocalDatabase::open(path: &Path) -> Result<LocalDatabase, LocalDbError>`.
- Produces: `DeviceSettings { device_id: Uuid, next_client_sequence: i64 }`.
- Consumes: a fixed application-data database path supplied by Tauri startup, never a frontend path.

- [ ] **Step 1: Write failing real-SQLite migration tests**

Tests use `tempfile::TempDir` and define these exact cases:

- `opening_empty_file_applies_migration_and_creates_stable_device`: open a new file, assert migration version `1`, one non-empty UUID device ID, and `next_client_sequence=1`.
- `reopening_database_keeps_device_id_and_sequence`: open, record the device settings, close, reopen the same path, and assert exact equality.
- `failing_migration_rolls_back_schema_and_version_row`: supply a test-only migration list whose second migration contains invalid SQL, then assert only the first committed version exists and no partial second table exists.

- [ ] **Step 2: Run Rust tests and verify failure**

Run:

```bash
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml local_db
```

Expected: FAIL because `local_db` is missing.

- [ ] **Step 3: Add SQLite dependencies and schema**

Use `rusqlite` with the `bundled` feature, `serde` with `derive`, `thiserror`, `uuid` with `v4` and `serde`, and `tempfile` as a dev dependency.

Migration `001_m4_foundation.sql` creates exactly:

- `schema_migrations`;
- `device_settings` with a positive `next_client_sequence` check;
- `local_projects` with structured M3 fields, `can_edit`, `local_updated_at`, and `sync_state` check;
- `sync_outbox` with protocol/action/entity checks and unique `(device_id, client_sequence)`;
- list filter indexes on name, year, status, and lifecycle.

- [ ] **Step 4: Implement transactional migrations**

Embed SQL with `include_str!`. For each unapplied version: begin a transaction, execute the migration, insert its version row, then commit. Return `LocalDbError::Migration { version }` without embedding SQL or filesystem paths in the user-visible error.

Initialize one device row only when none exists. Reject more than one row as corrupt state; never silently choose one.

- [ ] **Step 5: Verify migration and restart behavior**

Run:

```bash
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml local_db
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

Expected: all migration tests PASS and Clippy reports no warnings.

- [ ] **Step 6: Commit local database initialization**

```bash
git add apps/desktop/src-tauri
git commit -m "feat: add versioned desktop SQLite database"
```

---

### Task 5: Add fictional local project import and offline read commands

**Files:**

- Create: `apps/desktop/src-tauri/src/local_db/projects.rs`
- Create: `apps/desktop/src-tauri/src/local_db/fictional_seed.rs`
- Modify: `apps/desktop/src-tauri/src/local_db/mod.rs`
- Create: `apps/desktop/src-tauri/src/commands/projects.rs`
- Create: `apps/desktop/src-tauri/src/commands/status.rs`
- Create: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Create: `apps/desktop/src/platform/desktop-bridge.ts`
- Create: `apps/desktop/src/platform/desktop-bridge.test.ts`
- Create: `apps/desktop/src/repository/local-project-repository.ts`
- Create: `apps/desktop/src/repository/local-project-repository.test.ts`

**Interfaces:**

- Rust commands: `list_local_projects`, `get_local_project`, `get_local_status`.
- Development-only Rust command: `seed_fictional_local_project` compiled only with a development feature.
- TypeScript bridge: `DesktopBridge.listProjects`, `getProject`, `updateProject`, and `getLocalStatus`.
- Produces: `createLocalProjectRepository(bridge): ProjectRepository`.

- [ ] **Step 1: Write failing Rust read tests**

Use a fixed reserved fictional UUID and name beginning with `示例-`. Assert:

- importing twice creates one row;
- list filters query, year, status, lifecycle, page, and page size;
- list ordering is `local_updated_at DESC, id ASC`;
- detail returns `PROJECT_NOT_FOUND` for an absent ID;
- returned project fields and `canEdit` exactly match stored values.

- [ ] **Step 2: Run Rust tests and verify failure**

Run:

```bash
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml project_read
```

Expected: FAIL because project query functions are missing.

- [ ] **Step 3: Implement parameterized project reads**

Build filter predicates from fixed SQL fragments and bind every value with rusqlite parameters. Do not accept field names, sort expressions, or SQL text from TypeScript. Map every row into a Rust `LocalProjectDetails` DTO and validate lifecycle, status, date, boolean, revision, and sequence before returning it.

- [ ] **Step 4: Write failing TypeScript bridge and adapter tests**

Mock only `invoke`. Assert exact command names and camelCase payloads, safe mapping of `PROJECT_NOT_FOUND`, and `syncState` propagation. Assert the adapter source contains no SQL keywords such as `SELECT`, `INSERT`, or `UPDATE`.

- [ ] **Step 5: Implement the narrow bridge and repository adapter**

Define:

```ts
export interface LocalStatus {
  deviceId: string;
  pendingCount: number;
}

export interface DesktopBridge {
  listProjects(filters: ProjectListFilters): Promise<ProjectPage>;
  getProject(projectId: string): Promise<ProjectDetails>;
  updateProject(projectId: string, input: ProjectInput): Promise<ProjectDetails>;
  getLocalStatus(): Promise<LocalStatus>;
}
```

The production implementation imports `invoke` from `@tauri-apps/api/core`. Tests inject a fake implementation; no test invokes a real desktop runtime.

- [ ] **Step 6: Verify both sides**

Run:

```bash
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml project_read
npm run test -- --run apps/desktop/src/platform apps/desktop/src/repository
npm run typecheck --workspace @project-online/desktop
```

Expected: Rust and TypeScript tests PASS.

- [ ] **Step 7: Commit offline project reads**

```bash
git add apps/desktop/src apps/desktop/src-tauri
git commit -m "feat: read cached projects offline"
```

---

### Task 6: Implement atomic local project edit and Outbox creation

**Files:**

- Modify: `apps/desktop/src-tauri/src/local_db/projects.rs`
- Create: `apps/desktop/src-tauri/src/local_db/outbox.rs`
- Modify: `apps/desktop/src-tauri/src/commands/projects.rs`
- Modify: `apps/desktop/src-tauri/src/local_db/tests.rs`
- Modify: `apps/desktop/src/platform/desktop-bridge.ts`
- Modify: `apps/desktop/src/repository/local-project-repository.ts`
- Modify: `apps/desktop/src/repository/local-project-repository.test.ts`

**Interfaces:**

- Rust: `LocalDatabase::update_project(input: UpdateLocalProject) -> Result<LocalProjectDetails, LocalDbError>`.
- Command: `update_local_project(project_id, input)`.
- Outbox envelope: protocol version `1`, entity `PROJECT`, action `UPSERT`, one unique operation ID, and one device-local sequence.

- [ ] **Step 1: Write the failing transaction-success test**

Seed an editable project, update its name, and assert in one reopened database:

- local project contains the new fields;
- `sync_state` is `PENDING`;
- server `revision` and `commit_sequence` did not change;
- exactly one Outbox row exists;
- `base_revision` equals the pre-edit server revision;
- payload contains only `ProjectInput` fields;
- device `next_client_sequence` advanced by one.

- [ ] **Step 2: Write failing rollback and permission tests**

Add tests for:

- a trigger that aborts `sync_outbox` insertion, proving the project and sequence remain unchanged;
- `can_edit=0`, returning `PROJECT_FORBIDDEN` with no writes;
- invalid project input, returning field errors with no writes;
- two successful saves, producing distinct operation IDs and consecutive client sequences.

- [ ] **Step 3: Run tests and verify the expected failures**

Run:

```bash
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml project_update
```

Expected: FAIL because atomic update is missing.

- [ ] **Step 4: Implement one explicit SQLite transaction**

Use `transaction_with_behavior(TransactionBehavior::Immediate)`. Inside that transaction:

1. read and validate the current row and `can_edit`;
2. read device ID and `next_client_sequence`;
3. create UUID `operation_id` and a canonical serialized `ProjectInput` payload;
4. update structured project columns, `local_updated_at`, and `PENDING`;
5. insert the Outbox row with old `revision` as `base_revision`;
6. increment `next_client_sequence` with an expected-current-value predicate;
7. read the resulting details and commit.

Map busy/disk/constraint failures to stable safe error codes. Do not log payload JSON.

- [ ] **Step 5: Complete TypeScript error mapping**

Update the bridge and adapter to map `PROJECT_FORBIDDEN`, `PROJECT_NOT_FOUND`, `VALIDATION_FAILED`, and `LOCAL_WRITE_FAILED` into shared repository errors. Verify a successful update returns `PENDING` immediately.

- [ ] **Step 6: Run focused and package verification**

Run:

```bash
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml project_update
npm run test -- --run apps/desktop/src/repository/local-project-repository.test.ts
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

Expected: transaction, rollback, permission, validation, and sequence tests all PASS.

- [ ] **Step 7: Commit atomic offline editing**

```bash
git add apps/desktop/src apps/desktop/src-tauri
git commit -m "feat: persist project edits with atomic outbox"
```

---

### Task 7: Add operating-system credential adapters without plaintext fallback

**Files:**

- Modify: `apps/desktop/src-tauri/Cargo.toml`
- Modify: `apps/desktop/src-tauri/Cargo.lock`
- Create: `apps/desktop/src-tauri/src/credential/mod.rs`
- Create: `apps/desktop/src-tauri/src/credential/system.rs`
- Create: `apps/desktop/src-tauri/src/credential/memory.rs`
- Create: `apps/desktop/src-tauri/src/commands/credential.rs`
- Modify: `apps/desktop/src-tauri/src/commands/mod.rs`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `apps/desktop/src/platform/desktop-bridge.ts`
- Create: `apps/desktop/src/platform/credential-store.ts`
- Create: `apps/desktop/src/platform/credential-store.test.ts`

**Interfaces:**

- Rust trait: `CredentialStore::save`, `read`, and `delete` for one desktop session credential.
- Commands: `credential_status`, `save_credential`, and `delete_credential`.
- Frontend receives status `PRESENT`, `MISSING`, or `UNAVAILABLE`; only the authenticated bootstrap path may request the credential value.

- [ ] **Step 1: Write failing credential command tests with an in-memory store**

Test save/read/delete and error mapping through the command service. Use a fictional opaque value generated inside the test and assert that `Debug` output and user-safe errors never contain it.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml credential
```

Expected: FAIL because the credential abstraction is missing.

- [ ] **Step 3: Implement system credential storage**

Use the maintained `keyring` v1 API with fixed non-empty service `cn.projectonline.desktop` and account `desktop-session`. Serialize access through a mutex. Map not-found to `MISSING`; map unavailable/permission errors to `UNAVAILABLE`; never write the credential to SQLite, files, environment variables, or logs.

Compile and exercise the real backend only on macOS and Windows. Rust unit tests use `MemoryCredentialStore` exclusively.

- [ ] **Step 4: Write and implement TypeScript adapter tests**

Assert exact bridge calls, status mapping, and absence of `localStorage`, `sessionStorage`, IndexedDB, filesystem, and SQLite use in `credential-store.ts`.

- [ ] **Step 5: Run credential and platform tests**

Run:

```bash
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml credential
npm run test -- --run apps/desktop/src/platform/credential-store.test.ts
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

Expected: all tests PASS without accessing a real credential store.

- [ ] **Step 6: Commit credential adapters**

```bash
git add apps/desktop/src apps/desktop/src-tauri
git commit -m "feat: secure desktop session credentials"
```

---

### Task 8: Compose offline desktop UI and pending status

**Files:**

- Modify: `apps/desktop/src/app/DesktopApp.tsx`
- Modify: `apps/desktop/src/app/DesktopApp.test.tsx`
- Create: `apps/desktop/src/features/sync-status/SyncStatus.tsx`
- Create: `apps/desktop/src/features/sync-status/SyncStatus.test.tsx`
- Modify: `apps/desktop/src/main.tsx`
- Create: `apps/desktop/src/styles.css`
- Modify: `apps/desktop/src-tauri/src/lib.rs`
- Modify: `README.md`

**Interfaces:**

- Consumes: shared project UI, local repository, `DesktopBridge.getLocalStatus`.
- Produces: startup states `preparing`, `ready`, and `blocked`.
- Produces: visible offline status and exact pending-operation count.

- [ ] **Step 1: Write failing desktop composition tests**

Inject a fake bridge and assert:

- startup loads local status and project list without calling `fetch`;
- an empty database shows a local empty state, not a network error;
- selecting a project opens cached detail;
- saving edit refreshes detail and changes pending count from 0 to 1;
- remounting with the same fake persisted state shows the edited value;
- database initialization failure shows a blocking page and never claims the save succeeded.

- [ ] **Step 2: Write failing sync-status tests**

Assert exact copy:

- `pendingCount=0`: “本机数据已就绪”；
- `pendingCount=1`: “1 项修改待同步”；
- `pendingCount=3`: “3 项修改待同步”；
- always show “M4 暂不自动上传”.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
npm run test -- --run apps/desktop/src/app apps/desktop/src/features/sync-status
```

Expected: FAIL because the composition is not implemented.

- [ ] **Step 4: Implement the desktop composition root**

Initialize the production bridge once, create the local repository, and render the shared list/detail/edit flow. Refresh local status after every successful local save. Do not gate startup on browser network events and do not start timers or background upload loops.

Style only the desktop layout and shared M3 class names required for usable list, detail, dialog, error, and status states. Do not redesign unrelated Web screens.

- [ ] **Step 5: Register narrow Tauri commands**

Register only project list/detail/update, local status, development seed under a development feature, and credential commands. Store initialized database and credential service in managed Rust state. Startup migration failure must be returned to the blocking UI; do not delete the database.

- [ ] **Step 6: Document development and acceptance commands**

README must state:

- required Rust and Tauri prerequisites;
- commands for desktop dev, Rust tests, and debug build;
- fictional local seed is development-only;
- M4 Outbox is not uploaded until M5;
- no real credentials or existing databases are used by tests.

- [ ] **Step 7: Run desktop verification**

Run:

```bash
npm run test -- --run apps/desktop packages/ui/src/projects
npm run typecheck --workspace @project-online/desktop
npm run build:web --workspace @project-online/desktop
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
```

Expected: all commands PASS.

- [ ] **Step 8: Commit the offline desktop flow**

```bash
git add apps/desktop README.md
git commit -m "feat: complete offline desktop project flow"
```

---

### Task 9: Add macOS and Windows build gates and complete M4 acceptance

**Files:**

- Modify: `.github/workflows/verify.yml`
- Create: `.github/workflows/desktop-verify.yml`
- Create: `apps/desktop/scripts/verify-platform-config.mjs`
- Create: `apps/desktop/scripts/verify-platform-config.test.ts`
- Modify: `apps/desktop/package.json`
- Modify: `package.json`
- Modify: `TO-do.md`
- Modify: `README.md`

**Interfaces:**

- Produces: root command `npm run verify:desktop`.
- Produces: CI matrix for `macos-latest` and `windows-latest`.
- Produces: static gate rejecting forbidden Windows integration strings and permissions.

- [ ] **Step 1: Write the failing platform-config test**

The test invokes the verifier against one clean fixture and fixtures containing each forbidden lowercase token: `calendar`, `reminder`, `todo`, `microsoft to do`, `task integration`. It asserts a non-zero result naming only the file and forbidden category, not file contents.

- [ ] **Step 2: Run it and verify failure**

Run:

```bash
npm run test -- --run apps/desktop/scripts/verify-platform-config.test.ts
```

Expected: FAIL because the verifier is missing.

- [ ] **Step 3: Implement the platform configuration verifier**

Inspect only committed desktop configuration and Rust/TypeScript source under `apps/desktop`. Exclude tests and generated `target`/`dist`. Reject forbidden integration tokens unless they occur in the verifier's own allowlisted diagnostic definitions. Also parse capability JSON and assert it contains no shell, generic filesystem, or generic SQL permission.

- [ ] **Step 4: Add cross-platform CI**

Create `desktop-verify.yml` with a two-OS matrix. Each job:

1. checks out the repository;
2. installs Node 22 and runs `npm ci`;
3. installs stable Rust with the platform default target;
4. runs `npm run verify:desktop`;
5. runs `cargo test --locked` and `cargo clippy --locked -- -D warnings`;
6. runs a Tauri debug no-bundle build.

Do not add signing, notarization, updater keys, publishing, or secret-dependent steps.

- [ ] **Step 5: Run the complete local verification suite**

Run:

```bash
npm run verify
npm run verify:desktop
cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings
npm run build:desktop --workspace @project-online/desktop
git diff --check
```

Expected: TypeScript tests, M3 regression tests, Rust tests, Web builds, desktop frontend build, Tauri debug build, and platform configuration checks all PASS.

- [ ] **Step 6: Perform macOS runtime acceptance with fictional local data**

Use the development-only seed and a temporary application-data directory. Verify:

1. start while API and network-dependent dev services are stopped;
2. open the fixed fictional project list and detail;
3. edit the project and observe one pending operation;
4. close the app completely;
5. reopen and verify the edited value and pending count persist;
6. verify no credential value appears in console or application logs.

Delete only the explicitly created temporary acceptance directory after recording the result. Do not inspect or modify any existing application database.

- [ ] **Step 7: Record Windows CI evidence and update milestone status**

Only after the Windows job passes, mark M4 checklist items complete in `TO-do.md`. Update README current status to “M4 development and cross-platform build acceptance complete; M5 synchronization not implemented.” Do not claim signed production installers.

- [ ] **Step 8: Commit M4 acceptance**

```bash
git add .github/workflows apps/desktop package.json package-lock.json README.md TO-do.md
git commit -m "test: complete M4 desktop offline acceptance"
```

---

## Final Review Checklist

- [ ] `ProjectRepository` shared surface contains only list, detail, and update.
- [ ] Web creation, lifecycle, members, and audit M3 tests remain green.
- [ ] Frontend source cannot execute arbitrary SQL or choose a database path.
- [ ] Every successful edit creates exactly one independent Outbox operation.
- [ ] Project update, Outbox insert, and sequence increment roll back together.
- [ ] Local edits preserve the last server revision and commit sequence.
- [ ] Reopening the same temporary database preserves project, device, sequence, and Outbox.
- [ ] Credential tests use only the in-memory double and no plaintext fallback exists.
- [ ] Windows configuration has no calendar, reminder, task, or Microsoft To Do integration.
- [ ] M5 synchronization, M6 files, and M9 signing/updating are absent from M4 code.
- [ ] `npm run verify`, desktop verification, Rust tests, Clippy, and both platform builds pass.
