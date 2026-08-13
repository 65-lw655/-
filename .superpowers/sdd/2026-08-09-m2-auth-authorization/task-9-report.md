# Task 9 Report: Documentation and M2 Acceptance

## STATUS

`COMPLETE` — 自动化、联网审计和浏览器验收均已获得真实证据。`TO-do.md` 仅勾选已验证的账号、基础授权和 Web 能力；项目数据范围和项目业务授权仍保持未完成。

## Changed Files

- `README.md`：增加本地管理员初始化与启动顺序，说明单机开发认证状态边界和用户自行设置密码规则。
- `docs/architecture/domain-model.md`：将账号状态与凭证状态拆分，补充一次性凭证和会话摘要模型。
- `docs/architecture/permission-matrix.md`：增加账号启用且凭证就绪前置条件，以及管理员不能设置、读取或导出用户密码的规则。
- `docs/superpowers/plans/2026-08-09-m2-auth-authorization.md`：依据实际证据勾选文档和敏感边界步骤。
- `apps/web/src/App.tsx`：移除认证缺失和健康检查 effect 中的同步状态更新；缺失认证客户端时派生匿名视图，健康检查继续依赖已有的加载回退状态。
- `apps/web/src/features/admin-users/AdminUsersView.tsx`：初始用户加载改为在异步回调中更新状态，命令后的显式重新加载保持原行为。
- `apps/web/src/styles.css`：限制管理员用户区的 Grid 最小宽度，并在移动端保持账户角色字段单行显示；用户表继续在其容器内滚动。
- `apps/web/src/App.test.tsx`、`apps/web/src/features/admin-users/AdminUsersView.test.tsx`：保留 Task 7/8 已提交的会话入口、管理员视图、命令请求契约和刷新行为断言；Task 9 最终验证提交同时应用 Prettier 格式化。
- `apps/api/src/bootstrap-admin.ts`、`apps/api/src/config.ts`、`apps/api/src/modules/auth/routes.ts`、`apps/api/src/modules/users/http.test.ts`、`apps/api/src/modules/users/routes.ts`、`apps/web/src/features/admin-users/admin-users-client.ts`、`apps/web/src/features/auth/auth-client.ts`、`apps/web/src/features/auth/auth.test.tsx`、`apps/web/src/features/auth/LoginView.tsx`、`apps/web/src/features/auth/SetPasswordView.tsx`、`packages/domain/src/auth/authorization.test.ts`、`packages/domain/src/auth/types.ts`：Task 9 未新增业务行为，仅为满足最终 `format:check` 应用 Prettier 格式化；其中测试原有断言来自此前已完成任务。
- `TO-do.md`：仅勾选已验证的 M2.1、M2.2 基础授权规则和 M2.3 条目；项目数据范围及项目业务授权条目保持未完成。
- `apps/web/src/features/auth/SetPasswordView.tsx`：Task 7 模式切换直接测试明确停车；父层按模式使用 `key` 重新挂载表单，本轮不扩展测试或代码改动。

## Verification

| Command | Result |
| --- | --- |
| `npm ci` | exit 0 |
| `npm run test -- --run apps/web/src/App.test.tsx apps/web/src/features/admin-users/AdminUsersView.test.tsx` | exit 0；2 个测试文件、21 个测试通过 |
| `npm run lint` | exit 0；修复 3 项 `react-hooks/set-state-in-effect` 违规，未关闭或规避规则 |
| `npm run format:check` | exit 0；对最终检查报告的 16 个 M2 文件执行 Prettier write，未格式化无关文件 |
| `npm run typecheck` | exit 0 |
| `npm run test -- --run` | 此前完整运行 exit 0；19 个测试文件、210 个测试通过、0 failures |
| `npm run build` | exit 0 |
| `npm audit` | 控制器联网运行通过；0 vulnerabilities |
| `git diff --check` | exit 0 |
| `git check-ignore apps/api/.local-data/auth-store.json` | exit 0；本地认证状态路径被忽略 |

## Sensitive Boundaries

- 未连接、读取或查询数据库，未执行 SQL，未添加生产数据库适配。
- 未读取或打印任何本地认证状态文件；临时状态仅由运行时初始化和既有自动化测试使用。
- 现有存储测试通过，覆盖运行时生成的密码、会话令牌和一次性码不出现在持久化内容中。
- 未在文档、提交信息或本报告中记录密码、Cookie、会话令牌或完整一次性码。

## Browser Acceptance

- 应用内浏览器在 `1440×900` 完成管理员登录、用户开通、一次性码关闭后不可恢复、普通用户自助激活与登录、管理员视图隐藏、管理员接口 `403` 和停用后旧会话 `401`；控制台 error/warn 为空。
- 应用内浏览器的精确移动视口能力受后端最小宽度限制，控制器以本机无头 Chrome 补做精确 `390×844` 检查。
- 移动端 CSS 修复后：无页面横向溢出，用户表仅在自身容器内滚动，角色字段单行显示，用户管理可见，无框架错误覆盖，截图人工检查无文字重叠。

## Commit

- `4c53205 docs: record M2 acceptance prerequisites`
- 该提交仅保存已验证文档，不使用计划中的最终 M2 文档提交信息。
- `2a8f92b fix: satisfy M2 verification checks`
- `4e5d407 fix: contain M2 mobile layouts`
- `6f73d84 docs: complete M2 authentication workflow`
- `1edc744 docs: align M2 completion evidence`

## Remaining Work

无。Task 9 已完成；M2.2 的项目数据范围和项目业务授权，以及 M3 及后续条目保持未勾选。
