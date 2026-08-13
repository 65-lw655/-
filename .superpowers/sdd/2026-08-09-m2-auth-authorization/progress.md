# SDD ledger — plan: docs/superpowers/plans/2026-08-09-m2-auth-authorization.md

Execution branch: `codex/m2-auth-authorization`
Starting commit: `b8b5546`

Task 1: complete
Implementation: `213fab4 feat: implement M2 authorization matrix`
Review: spec compliant, quality approved, no findings
Tests: focused 26/26; full suite 53/53; domain typecheck/build passed

Task 2: complete
Implementation: `e5dffa9 feat: add password and session secret primitives`
Review: spec compliant, quality approved, no findings
Tests: focused 13/13; full suite 66/66; API typecheck passed

Task 3: fix round 1 started
Findings: state reference escape; memory/file validation mismatch; audit extra-field spread

Task 3: complete
Implementation: `8f1d333 feat: add local M2 authentication store`
Fix round 1: `78dce35 fix: harden local authentication state boundaries`
Review: all findings addressed; no new breakage; approved
Tests: focused 24/24; full suite 90/90; API typecheck/lint/format passed

Task 4: fix round 1 started
Findings: transaction-time ticket expiry/issuance; denied admin audit actor attribution

Task 4: complete
Implementation: `c3091d8 feat: add self-service credential lifecycle`
Fix round 1: `717e267 fix: align credential timing and audit actors`
Review: all findings addressed; no new breakage; approved
Tests: focused 23/23; full suite 113/113; API typecheck/lint/format passed

Task 5: complete
Implementation: `914c3d7 feat: add login sessions and authorization services`
Review: spec compliant, quality approved; one non-blocking minor test-gap observation parked
Tests: focused 28/28; full suite 141/141; API typecheck/lint/format passed
Parked minor: add regression coverage for the 15-minute failure-window boundary and cross-bucket isolation if this area changes

Task 6: fix round 1 started
Finding: mutating no-body endpoints accept and ignore arbitrary JSON bodies; add empty-object schemas and focused rejection tests

Task 6: fix round 2 started
Finding: empty-object schemas still allow JSON null via nullable=true; remove nullable and add null-body rejection tests

Task 6: complete
Implementation: `9376ace feat: expose M2 authentication and user APIs`
Fix round 1: `35748a8 fix: reject unexpected authentication API bodies`
Fix round 2: `7a1987b fix: reject null authentication API bodies`
Review: all findings addressed; no new breakage; approved
Tests: API 128/128; focused HTTP 23/23; API typecheck/build and npm audit passed
Concern: inherited early RED evidence could not be replayed without reverting prior work; all prescribed GREEN and integration checks passed

Task 7: fix round 1 started
Findings: activation/reset views are not reachable from the anonymous app flow; session restore GET lacks a no-store cache policy

Task 7: minor (deferred): mode-switch test does not directly fill ticket/password before asserting remount-based clearing
Task 7: complete
Implementation: `8ac58a9 feat: add Web login and session experience`
Fix round 1: `bfadb03 fix: complete Web authentication entry flows`
Review: Important findings resolved; one non-blocking minor coverage observation parked
Tests: focused Web 27/27; Web typecheck/build passed

Task 8: fix round 1 started
Findings: App permission test does not prove AdminUsersView renders and uses an invalid users mock; command-success tests do not assert list refresh

Task 8: fix round 2 started
Finding: only create-user proves list refresh; reissue activation, enable/disable, role change, and password reset still lack refresh assertions

Task 8: fix round 3 started
Finding: refresh-sequence assertions replaced HTTP method and role-body assertions, allowing malformed command requests to pass

Task 8: complete
Implementation: `af097aa feat: add administrator user management`
Fix round 1: `015d562 test: verify administrator management integration`
Fix round 2: `80113e0 test: verify all user commands refresh`
Fix round 3: `282b997 test: preserve administrator request contracts`
Review: all findings addressed; no new breakage; approved
Tests: focused admin/App 21/21; focused admin 8/8; Web typecheck/build passed

Task 9: fix round 1 started
Findings: M2.2 overstates project-scope and delete-test completion; README and task report contain stale browser/TO-do status; two minor architecture-doc numbering/duplication issues

Task 9: fix round 2 started
Finding: report inaccurately grouped test behavior changes under "formatting only"; distinguish prior task assertions from Task 9 formatting
