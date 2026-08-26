# Task 5 Report: Sync HTTP Routes And Runtime Wiring

## Summary

- Added Fastify sync routes for `POST /api/v1/sync/push` and `GET /api/v1/sync/pull`.
- Kept route wiring narrow through `ApiServices.syncService` and reused the existing runtime pool/repository/authorization dependencies.
- Added request/response schemas that reject unknown fields and now accept both normal `PROJECT` pull changes and forward-compatible `PROJECT_ACCESS_REVOKED` instructions.
- Added HTTP tests with in-memory service doubles for authentication, validation, push delegation, duplicate results, pull pagination, session error mapping, and revocation-instruction responses.
- Extended the shared sync protocol types so pull responses can carry revocation instructions without changing current `SyncService.pullProjects` behavior.

## Red/Green Evidence

- RED: `npm run typecheck --workspace @project-online/sync` failed because `PullProjectsResponse.changes` only accepted `type: "PROJECT"` and rejected `PROJECT_ACCESS_REVOKED`.
- GREEN: the same sync package typecheck passed after introducing the `ProjectAccessRevokedChange` union.
- RED: `npm run test -- --run apps/api/src/modules/sync/http.test.ts` failed because the Fastify pull response schema rejected a revocation instruction and returned `500`.
- GREEN: the same focused HTTP test command passed after widening the pull response schema to accept either project changes or revocation instructions.

## Verification

- `npm run typecheck --workspace @project-online/sync`
- `npm run test -- --run apps/api/src/modules/sync/http.test.ts`
- `npm run typecheck --workspace @project-online/api`
- `git diff --check`

## Notes

- This follow-up is protocol-compatible forward support only; current pull service behavior remains `PROJECT`-only.
- Route tests use only in-memory doubles and do not connect to any database.
