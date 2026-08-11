# Task 6 Report

## STATUS

DONE_WITH_CONCERNS

## 改动文件

- `.env.example`
- `package.json`
- `package-lock.json`
- `apps/api/package.json`
- `apps/api/src/app.ts`
- `apps/api/src/app.test.ts`
- `apps/api/src/config.ts`
- `apps/api/src/config.test.ts`
- `apps/api/src/server.ts`
- `apps/api/src/runtime.ts`
- `apps/api/src/bootstrap-admin.ts`
- `apps/api/src/bootstrap-admin.test.ts`
- `apps/api/src/terminal-password.ts`
- `apps/api/src/terminal-password.test.ts`
- `apps/api/src/modules/auth/routes.ts`
- `apps/api/src/modules/auth/http.test.ts`
- `apps/api/src/modules/users/routes.ts`
- `apps/api/src/modules/users/http.test.ts`

## TDD 与验证结果

- 审查并保留了接手时已有的 Task 6 未提交实现；所有测试凭证均在运行时生成。
- 本次接手后运行的配置、认证 HTTP、用户 HTTP、应用运行时、首管与终端密码测试均通过。
- `npm run test -- --run apps/api/src`：12 个测试文件、128 项测试通过。
- `npm run typecheck --workspace @project-online/api`：通过。
- `npm run build --workspace @project-online/api`：双入口构建通过。
- `npm audit`：0 个已知漏洞。
- 全程未连接、读取或查询数据库，也未执行 SQL。

## 提交

`9376ace feat: expose M2 authentication and user APIs`

## 未解决关注点

- 接手时认证、用户和首管实现已存在，因此无法在不回滚继承代码的前提下重现 Task 6 早期 RED 阶段；本次已完成全部规定 GREEN 与集成验证。

## Fix Round 1

- 根因：六个无请求体变更端点没有 `body` Schema，因此 Fastify 接受并忽略了任意 JSON 对象。
- RED：新增 6 项聚焦 HTTP 测试后，相关端点返回 200 或 204，而非预期的 400。
- GREEN：为认证刷新/退出及用户激活重发、停用、启用、密码重置端点增加可空空对象 Schema；含未知字段的对象返回 `VALIDATION_ERROR`，原有无 body 调用保持可用。
- 验证：`npm run test -- --run apps/api/src/modules/auth/http.test.ts apps/api/src/modules/users/http.test.ts` 通过（2 个文件、21 项测试）；`npm run typecheck --workspace @project-online/api` 通过。
- 提交：`35748a8 fix: reject unexpected authentication API bodies`

## Fix Round 2

- 根因：共享 `emptyObjectSchema` 的 `nullable: true` 允许显式 JSON `null` 通过 no-argument write endpoint 的 schema 校验。
- RED：在认证刷新和用户重发激活 HTTP 测试中增加显式 JSON `null` body 覆盖；旧实现分别返回 204 和 200，而预期为 400 `VALIDATION_ERROR`。
- GREEN：删除认证、用户两处 `emptyObjectSchema` 的 `nullable: true`；通过 `preValidation` 将真正缺失的 body 规范化为空对象，保持原有无 body 调用兼容，同时让显式 JSON `null` 返回 400。
- 验证：`npm run test -- --run apps/api/src/modules/auth/http.test.ts apps/api/src/modules/users/http.test.ts` 通过（2 个文件、23 项测试）；`npm run typecheck --workspace @project-online/api` 通过；`git diff --check` 通过。
- 提交信息：`fix: reject null authentication API bodies`
