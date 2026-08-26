# Task 5 Report: Offline Project Reads

## Summary

- Added local SQLite project read models and parameterized read methods.
- Added idempotent fictional local project seed for tests and `development` feature builds.
- Added Tauri commands for local project list/detail/status.
- Added TypeScript desktop bridge and local `ProjectRepository` adapter.
- Kept SQL out of the TypeScript adapter; SQL remains only in Rust local database code.

## Red/Green Evidence

- RED: `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml project_read` failed because `ProjectListFilters`, `seed_fictional_local_project`, `list_projects`, and `get_project` were missing.
- GREEN: the same Rust focused command passed after implementing the local read layer.
- RED: `npm run test -- --run apps/desktop/src/platform apps/desktop/src/repository` failed because bridge and repository modules were missing.
- GREEN: the same Vitest focused command passed after implementing bridge and adapter.

## Verification

- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml project_read`
- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml --features development project_read`
- `npm run test -- --run apps/desktop/src/platform apps/desktop/src/repository`
- `npm run typecheck --workspace @project-online/desktop`

## Notes

- Tests use only fixed fictional project data and temporary SQLite files.
- No existing database was opened, queried, or inspected.
- `updateProject` is bridge/adapter-only in this task; the matching local mutation command is intentionally left for Task 6.
