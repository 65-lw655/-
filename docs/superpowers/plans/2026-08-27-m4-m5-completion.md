# M4/M5 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Close the M4 Windows CI gate, connect desktop startup/manual synchronization, and complete retry, conflict, and invalid-session handling for the M5 project sync slice.

**Architecture:** Keep the existing project vertical slice. The desktop app owns a small sync coordinator that invokes the existing `syncProjectsOnce` client through the Tauri bridge; the API keeps transaction boundaries in `SyncService` and exposes typed result statuses. Retry behavior remains in the client and is observable through local outbox failure state.

**Tech Stack:** TypeScript, React, Vitest, Rust/Tauri, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-23-m4-desktop-offline-foundation-design.md` and `docs/superpowers/plans/2026-08-24-m5-project-sync-slice.md`.

## Global Constraints

- Do not read or query existing database data; database validation uses isolated test fixtures only.
- Do not add credentials, tokens, or secrets to source files or logs.
- Preserve the existing project entity vertical slice and transaction boundaries.
- Every behavior change gets a failing test before production code.

### Task 1: Windows CI gate and M4 acceptance evidence

**Files:**
- Modify: `.github/workflows/desktop-verify.yml`
- Modify: `docs/acceptance/m4-platform-acceptance-2026-08-26.md`
- Test: workflow syntax and local desktop verification commands

- [ ] Verify the workflow uses Windows-compatible npm/Rust commands and the required matrix.
- [ ] Run the complete local desktop gate as the macOS baseline.
- [ ] Push the workflow to GitHub and record the Windows run URL/result before closing M4.

### Task 2: Desktop sync coordinator and triggers

**Files:**
- Create: `apps/desktop/src/sync/sync-coordinator.ts`
- Test: `apps/desktop/src/sync/sync-coordinator.test.ts`
- Modify: `apps/desktop/src/platform/desktop-bridge.ts`
- Modify: `apps/desktop/src/app/DesktopApp.tsx`
- Modify: `apps/desktop/src/features/sync-status/SyncStatus.tsx`
- Test: `apps/desktop/src/app/DesktopApp.test.tsx`

- [ ] Add a failing test for a manual sync command calling `syncProjectsOnce` once and exposing result state.
- [ ] Add a failing test for startup synchronization after local status becomes ready.
- [ ] Implement a coordinator with a single-flight guard and explicit `idle/running/success/error` state.
- [ ] Add a “立即同步” button and startup invocation without blocking local startup when offline.
- [ ] Run focused desktop tests and typecheck.

### Task 3: M5 retry, conflict, and invalid-session closure

**Files:**
- Modify: `apps/desktop/src/sync/sync-client.ts`
- Test: `apps/desktop/src/sync/sync-client.test.ts`
- Modify: `apps/api/src/modules/sync/sync-service.ts`
- Test: `apps/api/src/modules/sync/sync-service.integration.test.ts`
- Modify: `docs/architecture/sync-protocol.md`

- [ ] Add failing tests for bounded retry of `RETRYABLE` results, conflict metadata retention, and `401 INVALID_SESSION` propagation.
- [ ] Implement bounded exponential retry in the client without acknowledging failed outbox items.
- [ ] Preserve conflict results as successful server commits while returning conflict metadata to the UI.
- [ ] Map invalid session responses to a typed client error so the desktop coordinator can request re-authentication.
- [ ] Run sync unit/integration tests and the full verification suite.

### Task 4: Final verification and commit

- [ ] Run `npm run verify`, `npm run verify:desktop`, Rust tests, Clippy, and desktop build.
- [ ] Update milestone documents with exact command results and any remaining external acceptance dependency.
- [ ] Commit the completed M4/M5 work on the current branch.
