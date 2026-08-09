# M2 Authentication and Authorization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付管理员开通账号、所有用户自行设置密码、服务端不透明会话、统一项目授权和 Web 用户管理闭环。

**Architecture:** 共享领域包保存账号枚举和纯授权函数；API 以 `AuthStateStore` 事务接口隔离本地文件存储，账号服务、凭证服务和会话服务均不直接访问文件。Fastify 只负责 Schema、Cookie、同源校验和服务调用；React Web 通过 Cookie 恢复会话，不持久化任何凭证。

**Tech Stack:** Node.js 22、TypeScript、Node Crypto、Fastify 5、`@fastify/cookie`、React 19、Vite 8、Vitest、Testing Library、ESLint、Prettier、esbuild

## Global Constraints

- 不连接、读取或查询数据库，不创建 SQL、迁移脚本或数据库配置。
- 不在源码、日志、文档、测试快照或示例配置中写入真实密码、令牌、密钥、证书或个人敏感信息。
- 测试密码和一次性凭证在测试运行时随机生成，不使用固定密码字面量。
- 管理员只能开通账号和签发一次性码，不能替任何用户设置、读取或导出密码。
- 首位管理员和其他用户都必须自行设置密码。
- 只有账号启用且凭证就绪的用户可以登录和访问受保护 API。
- `ADMIN` 全局业务可读写；`LEADER` 全局只读；`USER` 按项目成员关系访问。
- 完整项目导出仅 `OWNER`；审计记录不能修改或删除。
- M2 本地文件存储只用于单 API 进程开发和验收，不作为生产数据库。
- 不实现项目 CRUD、邮件短信、离线同步、桌面安全存储或对象存储。

---

## File Map

### Shared domain

- `packages/domain/src/auth/types.ts`：账号、凭证、角色、动作和授权结果类型。
- `packages/domain/src/auth/authorization.ts`：唯一项目权限判定函数。
- `packages/domain/src/auth/authorization.test.ts`：M0 第 9 节 19 个授权示例。
- `packages/domain/src/index.ts`：导出 M2 公共类型和函数。

### API security and storage

- `apps/api/src/modules/auth/password.ts`：scrypt 哈希、校验和密码规则。
- `apps/api/src/modules/auth/password.test.ts`：密码原语测试。
- `apps/api/src/modules/auth/secrets.ts`：随机会话令牌、一次性码和摘要。
- `apps/api/src/modules/auth/secrets.test.ts`：随机值和摘要测试。
- `apps/api/src/storage/auth-state.ts`：持久化状态类型和 `AuthStateStore` 接口。
- `apps/api/src/storage/memory-auth-state-store.ts`：测试和注入用内存实现。
- `apps/api/src/storage/file-auth-state-store.ts`：本机 JSON 原子文件实现。
- `apps/api/src/storage/file-auth-state-store.test.ts`：重启、损坏和敏感明文测试。
- `apps/api/src/modules/audit/security-audit.ts`：安全审计事件创建器。

### API services and routes

- `apps/api/src/modules/users/user-service.ts`：账号开通、启停、角色和一次性码生命周期。
- `apps/api/src/modules/users/user-service.test.ts`：账号生命周期与最后管理员保护。
- `apps/api/src/modules/auth/auth-service.ts`：登录、鉴权、刷新、退出和修改密码。
- `apps/api/src/modules/auth/auth-service.test.ts`：会话、登录限制和强制撤销。
- `apps/api/src/modules/authorization/authorization-service.ts`：把当前身份和项目成员关系交给领域授权函数。
- `apps/api/src/modules/authorization/authorization-service.test.ts`：角色撤销和越权测试。
- `apps/api/src/modules/auth/routes.ts`：认证路由和 Cookie。
- `apps/api/src/modules/users/routes.ts`：管理员用户路由。
- `apps/api/src/modules/auth/http.test.ts`：认证 API 集成测试。
- `apps/api/src/modules/users/http.test.ts`：用户管理 API 集成测试。
- `apps/api/src/runtime.ts`：装配本地状态仓储和服务。
- `apps/api/src/terminal-password.ts`：跨平台隐藏密码输入。
- `apps/api/src/bootstrap-admin.ts`：首位管理员交互式初始化命令。
- `apps/api/src/bootstrap-admin.test.ts`：初始化命令服务测试。
- `apps/api/src/app.ts`：注册 Cookie、认证与用户模块。
- `apps/api/src/config.ts`：公开 Web 地址和本地状态路径配置。
- `apps/api/src/server.ts`：加载运行时服务后启动 Fastify。

### Web

- `apps/web/src/api-client.ts`：统一 JSON、错误码和 Cookie 请求客户端。
- `apps/web/src/features/auth/auth-client.ts`：认证 API 调用。
- `apps/web/src/features/auth/LoginView.tsx`：登录表单。
- `apps/web/src/features/auth/SetPasswordView.tsx`：激活或重置时自行设置密码。
- `apps/web/src/features/auth/AccountView.tsx`：当前身份、修改密码和退出。
- `apps/web/src/features/auth/auth.test.tsx`：登录、激活、过期和退出测试。
- `apps/web/src/features/admin-users/admin-users-client.ts`：用户管理 API 调用。
- `apps/web/src/features/admin-users/AdminUsersView.tsx`：用户表格和管理命令。
- `apps/web/src/features/admin-users/AdminUsersView.test.tsx`：管理员交互和一次性码测试。
- `apps/web/src/App.tsx`：会话状态机和角色视图切换。
- `apps/web/src/App.test.tsx`：应用级会话恢复和权限视图测试。
- `apps/web/src/styles.css`：登录与内部管理工具响应式样式。

---

### Task 1: Implement the Shared Authorization Domain

**Files:**
- Create: `packages/domain/src/auth/types.ts`
- Create: `packages/domain/src/auth/authorization.ts`
- Create: `packages/domain/src/auth/authorization.test.ts`
- Modify: `packages/domain/src/index.ts`

**Interfaces:**
- Produces: `SystemRole`、`AccountStatus`、`CredentialStatus`、`ProjectMemberRole`、`AuthorizationAction`、`AuthorizationContext`、`AuthorizationDecision`。
- Produces: `authorizeAction(context, action): AuthorizationDecision`。
- Consumes: 无运行时依赖。

- [x] **Step 1: Write the failing authorization matrix test**

在 `authorization.test.ts` 建立运行时表格，逐条覆盖 M0 的 19 个示例。表格必须包含以下场景和结论：

```ts
const cases = [
  ["非成员普通用户读取", user(null), "PROJECT_READ", false],
  ["VIEWER 读取合同", user("VIEWER"), "PROJECT_READ", true],
  ["VIEWER 修改合同", user("VIEWER"), "BUSINESS_UPDATE", false],
  ["EDITOR 新增回款", user("EDITOR"), "BUSINESS_CREATE", true],
  ["EDITOR 管理成员", user("EDITOR"), "MEMBER_MANAGE", false],
  ["OWNER 管理成员", user("OWNER"), "MEMBER_MANAGE", true],
  ["OWNER 移除最后负责人", user("OWNER"), "REMOVE_LAST_OWNER", false],
  ["非成员领导读取", leader(null), "PROJECT_READ", true],
  ["非成员领导修改", leader(null), "BUSINESS_UPDATE", false],
  ["管理员创建项目", admin(null), "PROJECT_CREATE", true],
  ["管理员跨项目修改", admin(null), "BUSINESS_UPDATE", true],
  ["管理员管理用户", admin(null), "USER_MANAGE", true],
  ["成员下载文件", user("VIEWER"), "FILE_DOWNLOAD", true],
  ["领导跨项目下载", leader(null), "FILE_DOWNLOAD", true],
  ["权限撤销后同步写入", user(null), "SYNC_WRITE", false],
  ["停用账号访问", disabledUser("OWNER"), "PROJECT_READ", false],
  ["OWNER 完整导出", user("OWNER"), "PROJECT_EXPORT", true],
  ["非成员管理员完整导出", admin(null), "PROJECT_EXPORT", false],
  ["管理员角色撤销后同步写入", user(null), "SYNC_WRITE", false]
] as const;
```

额外断言管理员跨项目写入和领导跨项目下载的成功结果包含 `auditRequired: true`，`AUDIT_MUTATE` 对所有角色都拒绝。

- [x] **Step 2: Run the domain test and verify RED**

Run: `npm run test -- --run packages/domain/src/auth/authorization.test.ts`

Expected: FAIL，因为 `auth/authorization.ts` 和导出类型尚不存在。

- [x] **Step 3: Add exact shared types**

在 `types.ts` 定义：

```ts
export type SystemRole = "USER" | "LEADER" | "ADMIN";
export type AccountStatus = "ACTIVE" | "DISABLED";
export type CredentialStatus =
  | "PENDING_ACTIVATION"
  | "READY"
  | "RESET_REQUIRED";
export type ProjectMemberRole = "OWNER" | "EDITOR" | "VIEWER";

export type AuthorizationAction =
  | "PROJECT_LIST"
  | "PROJECT_READ"
  | "PROJECT_CREATE"
  | "BUSINESS_CREATE"
  | "BUSINESS_UPDATE"
  | "BUSINESS_DELETE"
  | "MEMBER_MANAGE"
  | "REMOVE_LAST_OWNER"
  | "PROJECT_ARCHIVE"
  | "PROJECT_RESTORE"
  | "PROJECT_EXPORT"
  | "FILE_DOWNLOAD"
  | "AUDIT_READ"
  | "AUDIT_MUTATE"
  | "USER_MANAGE"
  | "SYNC_WRITE";

export interface AuthorizationContext {
  accountStatus: AccountStatus;
  credentialStatus: CredentialStatus;
  sessionValid: boolean;
  systemRole: SystemRole;
  projectExists: boolean;
  memberRole: ProjectMemberRole | null;
}

export type AuthorizationDecision =
  | { allowed: true; auditRequired: boolean }
  | {
      allowed: false;
      reason:
        | "ACCOUNT_DISABLED"
        | "CREDENTIAL_NOT_READY"
        | "SESSION_INVALID"
        | "PROJECT_NOT_FOUND"
        | "FORBIDDEN";
    };
```

- [x] **Step 4: Implement the minimal pure authorization function**

判定顺序必须与设计第 10 节一致。`PROJECT_CREATE` 和 `USER_MANAGE` 不要求现有项目；其余项目动作先校验 `projectExists`。不读取客户端权限缓存，不引入类或策略注册表。

- [x] **Step 5: Verify and commit the domain**

Run:

```bash
npm run test -- --run packages/domain/src/auth/authorization.test.ts
npm run typecheck --workspace @project-online/domain
npm run build --workspace @project-online/domain
```

Expected: 19 个矩阵场景及补充保护测试全部通过。

```bash
git add packages/domain/src
git commit -m "feat: implement M2 authorization matrix"
```

---

### Task 2: Add Password and Secret Primitives

**Files:**
- Create: `apps/api/src/modules/auth/password.ts`
- Create: `apps/api/src/modules/auth/password.test.ts`
- Create: `apps/api/src/modules/auth/secrets.ts`
- Create: `apps/api/src/modules/auth/secrets.test.ts`

**Interfaces:**
- Produces: `validatePassword(password): PasswordValidationResult`。
- Produces: `PasswordHasher` 接口和 `nodePasswordHasher` 实现；方法为 `hash(password)` 与 `verify(password, encoded)`。
- Produces: `generateOpaqueSecret(): string` 和 `digestOpaqueSecret(secret): string`。
- Consumes: Node.js `node:crypto`，不增加第三方加密依赖。

- [x] **Step 1: Write failing password tests with runtime-generated values**

测试用密码通过以下函数运行时生成，不把密码字面量写入源码或快照：

```ts
function makeTestPassword(): string {
  return `${randomBytes(18).toString("base64url")}aA1!`;
}
```

覆盖：12 个 Unicode 码点下限、128 个码点上限、纯空白拒绝、相同密码产生不同哈希、正确密码通过、另一个随机密码拒绝、损坏格式返回 `false`。

- [x] **Step 2: Run password tests and verify RED**

Run: `npm run test -- --run apps/api/src/modules/auth/password.test.ts`

Expected: FAIL，因为密码模块不存在。

- [x] **Step 3: Implement versioned scrypt hashing**

使用异步 `scrypt`，参数固定为：

```ts
const SCRYPT_OPTIONS = {
  N: 2 ** 17,
  r: 8,
  p: 1,
  maxmem: 160 * 1024 * 1024
} as const;
const SALT_BYTES = 16;
const KEY_BYTES = 64;
```

接口固定为：

```ts
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encoded: string): Promise<boolean>;
}

export const nodePasswordHasher: PasswordHasher;
```

编码格式固定为：

```text
scrypt$v=1$N=131072,r=8,p=1$<base64url-salt>$<base64url-key>
```

解析时校验算法、版本、参数、盐和派生结果长度；比较使用 `timingSafeEqual`。任何错误都返回 `false`，不得把输入或哈希写入错误消息。账号和会话服务依赖 `PasswordHasher` 接口；只有本文件的专门测试执行真实 scrypt，服务单元测试注入不记录输入的测试实现。

- [x] **Step 4: Write and run failing opaque-secret tests**

覆盖 100 次生成均为非空且唯一、摘要稳定、不同秘密摘要不同、摘要不包含原秘密。

Run: `npm run test -- --run apps/api/src/modules/auth/secrets.test.ts`

Expected: FAIL，因为秘密模块不存在。

- [x] **Step 5: Implement opaque secrets and verify**

`generateOpaqueSecret` 使用 `randomBytes(32).toString("base64url")`；`digestOpaqueSecret` 使用 SHA-256 并输出 base64url。

Run:

```bash
npm run test -- --run apps/api/src/modules/auth/password.test.ts apps/api/src/modules/auth/secrets.test.ts
npm run typecheck --workspace @project-online/api
```

Expected: 密码和秘密测试全部通过，无敏感输入出现在输出中。

- [x] **Step 6: Commit security primitives**

```bash
git add apps/api/src/modules/auth
git commit -m "feat: add password and session secret primitives"
```

---

### Task 3: Implement Transactional Local Auth Storage

**Files:**
- Create: `apps/api/src/storage/auth-state.ts`
- Create: `apps/api/src/storage/memory-auth-state-store.ts`
- Create: `apps/api/src/storage/file-auth-state-store.ts`
- Create: `apps/api/src/storage/file-auth-state-store.test.ts`
- Create: `apps/api/src/modules/audit/security-audit.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `AuthState` 和内部存储实体。
- Produces: `AuthStateStore.read(reader)` 与 `AuthStateStore.update(mutator)`。
- Produces: `MemoryAuthStateStore` 和 `FileAuthStateStore.open(path)`。
- Consumes: Task 1 的角色与状态类型。

- [x] **Step 1: Write failing file-store tests**

使用 `mkdtemp` 创建临时目录，覆盖：空路径初始化版本 1、`update` 后重新 `open` 可读取、并发调用按调用顺序串行、损坏 JSON 拒绝打开、错误格式版本拒绝、文件内容不包含运行时生成的密码/会话令牌/一次性码。

- [x] **Step 2: Run storage tests and verify RED**

Run: `npm run test -- --run apps/api/src/storage/file-auth-state-store.test.ts`

Expected: FAIL，因为存储实现不存在。

- [x] **Step 3: Define the persisted state contract**

在 `auth-state.ts` 定义且只在 API 内部导出：

```ts
export interface AuthState {
  version: 1;
  users: StoredUser[];
  sessions: StoredSession[];
  tickets: StoredCredentialTicket[];
  loginAttempts: StoredLoginAttempt[];
  auditEvents: StoredSecurityAuditEvent[];
}

export interface AuthStateStore {
  read<T>(reader: (state: Readonly<AuthState>) => T): Promise<T>;
  update<T>(mutator: (state: AuthState) => T | Promise<T>): Promise<T>;
}
```

`StoredUser` 包含 ID、规范化登录名、显示名、角色、账号状态、凭证状态、可空密码哈希和时间；会话及一次性凭证只包含摘要；审计不包含完整登录名或请求体。

- [x] **Step 4: Implement memory and file stores**

`MemoryAuthStateStore` 在每次 `read` 使用 `structuredClone` 返回只读快照，在 `update` 内串行执行修改。`FileAuthStateStore`：

1. `open` 创建父目录和初始状态。
2. POSIX 系统将目录设置为 `0700`、文件设置为 `0600`；Windows 使用当前用户目录继承权限，不声称 POSIX mode 生效。
3. 每次更新先克隆当前状态，mutator 成功后序列化。
4. 写同目录随机临时文件并 `rename` 替换目标。
5. mutator 抛错时不改变内存或磁盘状态。
6. 所有更新共用一个 Promise 队列，确保单进程顺序写。

- [x] **Step 5: Add audit event construction and ignore local data**

`createSecurityAuditEvent` 只接受结构化字段：事件、结果、actorId、targetId、projectId、sourceDigest 和服务器时间。类型不提供密码、令牌、Cookie 或请求体字段。

在 `.gitignore` 的本地配置段增加：

```gitignore
.local-data/
```

- [x] **Step 6: Verify and commit storage**

Run:

```bash
npm run test -- --run apps/api/src/storage/file-auth-state-store.test.ts
npm run typecheck --workspace @project-online/api
git check-ignore apps/api/.local-data/auth-store.json
```

Expected: 存储测试通过，本地状态路径被忽略。

```bash
git add .gitignore apps/api/src/storage apps/api/src/modules/audit
git commit -m "feat: add local M2 authentication store"
```

---

### Task 4: Implement Account Provisioning and Credential Lifecycle

**Files:**
- Create: `apps/api/src/modules/users/user-service.ts`
- Create: `apps/api/src/modules/users/user-service.test.ts`
- Create: `apps/api/src/modules/users/public-user.ts`

**Interfaces:**
- Produces: `UserService.bootstrapAdmin`、`createUser`、`activate`、`reissueActivation`、`disableUser`、`enableUser`、`changeRole`、`issuePasswordReset`、`completePasswordReset`、`listUsers`。
- Produces: `PublicUser`，不包含任何凭证字段。
- Consumes: Tasks 1-3 的状态类型、`PasswordHasher`、秘密原语和 `AuthStateStore`。

- [ ] **Step 1: Write failing account-lifecycle tests**

使用 `MemoryAuthStateStore`、运行时生成的密码和测试 `PasswordHasher`，覆盖：

- 空仓储初始化首位 `ADMIN/ACTIVE/READY` 成功，已有任何用户时拒绝。
- 管理员开通账号不接收密码，得到 `ACTIVE/PENDING_ACTIVATION` 用户和一次性激活码。
- 激活成功设置密码并转为 `READY`；过期、重复使用和重新签发后的旧码均返回 `INVALID_TICKET`。
- 管理员停用账号撤销全部会话；启用只改变账号状态，不改变凭证状态。
- 管理员签发重置码后凭证转为 `RESET_REQUIRED` 并撤销会话；用户完成后转回 `READY`。
- 非管理员不能列出或修改用户。
- 不能停用最后一名有效管理员、撤销其角色或由其为自己签发重置码。
- 所有 `PublicUser` 结果不存在 `passwordHash`、ticket 摘要和 session 摘要。

- [ ] **Step 2: Run lifecycle tests and verify RED**

Run: `npm run test -- --run apps/api/src/modules/users/user-service.test.ts`

Expected: FAIL，因为 `UserService` 不存在。

- [ ] **Step 3: Implement explicit service inputs and outputs**

```ts
export interface AuthenticatedPrincipal {
  userId: string;
  sessionId: string;
  role: SystemRole;
}

export interface CreateUserInput {
  username: string;
  displayName: string;
  role: SystemRole;
}

export interface IssuedCredentialTicket {
  user: PublicUser;
  ticket: string;
  expiresAt: string;
}
```

登录名使用 `trim().toLocaleLowerCase("en-US")` 规范化；公开输入限制为 3-64 个字符，显示名限制为 1-80 个 Unicode 码点。错误使用稳定的 `ServiceError(code, statusCode)`，消息不包含输入值。

- [ ] **Step 4: Implement state transitions in store transactions**

开通、激活、重置、停用、角色变化和会话撤销必须各自在一次 `store.update` 中完成。一次性码明文只作为方法返回值存在，进入状态前立即摘要。所有成功和拒绝结果写有限安全审计。

- [ ] **Step 5: Verify and commit user lifecycle**

Run:

```bash
npm run test -- --run apps/api/src/modules/users/user-service.test.ts
npm run typecheck --workspace @project-online/api
```

Expected: 生命周期、越权和最后管理员保护全部通过。

```bash
git add apps/api/src/modules/users
git commit -m "feat: add self-service credential lifecycle"
```

---

### Task 5: Implement Login, Session Rotation, and Authorization Services

**Files:**
- Create: `apps/api/src/modules/auth/auth-service.ts`
- Create: `apps/api/src/modules/auth/auth-service.test.ts`
- Create: `apps/api/src/modules/authorization/authorization-service.ts`
- Create: `apps/api/src/modules/authorization/authorization-service.test.ts`

**Interfaces:**
- Produces: `AuthService.login`、`authenticate`、`refresh`、`logout`、`changePassword`。
- Produces: `AuthorizationService.authorize(principal, projectContext, action)`。
- Consumes: Tasks 1-4；构造时注入 `PasswordHasher` 和启动阶段生成的 dummy 密码哈希。

- [ ] **Step 1: Write failing authentication tests**

覆盖：正确登录创建摘要会话、错误密码统一 `INVALID_CREDENTIALS`、不存在账号调用 `PasswordHasher.verify` 校验 dummy 哈希后返回同一错误、停用和凭证未就绪返回同一错误、5 次失败后第 6 次返回 `LOGIN_RATE_LIMITED`、成功登录清除失败桶。

测试通过注入时钟推进时间，不使用真实等待；来源地址先 SHA-256 摘要后进入失败桶和审计。

- [ ] **Step 2: Run login tests and verify RED**

Run: `npm run test -- --run apps/api/src/modules/auth/auth-service.test.ts`

Expected: FAIL，因为 `AuthService` 不存在。

- [ ] **Step 3: Implement login and current-session authentication**

公开签名固定为：

```ts
login(input: {
  username: string;
  password: string;
  sourceAddress: string;
  deviceName: string;
}): Promise<{ token: string; expiresAt: string; user: PublicUser }>;

authenticate(token: string): Promise<AuthenticatedPrincipal>;
```

会话令牌有效期 30 分钟。`authenticate` 每次按令牌摘要读取会话和当前用户，拒绝过期、撤销、停用或凭证未就绪状态，返回当前角色而非会话创建时角色。

- [ ] **Step 4: Add failing refresh, logout, and password-change tests**

覆盖：有效刷新轮换令牌、旧令牌重复刷新拒绝、过期刷新拒绝、退出撤销当前会话、修改密码验证旧密码、修改成功撤销其他会话并轮换当前会话、管理员停用或调整角色后旧令牌拒绝。

- [ ] **Step 5: Implement session commands and verify**

`refresh`、`logout` 和 `changePassword` 各自在一次状态事务内完成摘要替换或撤销。明文新令牌只通过返回值传给 HTTP 层。

Run: `npm run test -- --run apps/api/src/modules/auth/auth-service.test.ts`

Expected: 登录、限制、轮换、退出和修改密码测试全部通过。

- [ ] **Step 6: Write and implement authorization-service tests**

测试服务从当前 principal 和项目成员输入构建 `AuthorizationContext`，调用 Task 1 的 `authorizeAction`。至少覆盖：管理员角色撤销后无成员同步写入拒绝、领导非成员写入拒绝、普通成员读取允许、账号停用优先拒绝。

Run: `npm run test -- --run apps/api/src/modules/authorization/authorization-service.test.ts`

Expected: 首次运行因模块缺失失败；实现最小服务后通过。

- [ ] **Step 7: Commit authentication services**

```bash
git add apps/api/src/modules/auth apps/api/src/modules/authorization
git commit -m "feat: add login sessions and authorization services"
```

---

### Task 6: Expose Fastify Authentication and User APIs

**Files:**
- Create: `apps/api/src/modules/auth/routes.ts`
- Create: `apps/api/src/modules/users/routes.ts`
- Create: `apps/api/src/modules/auth/http.test.ts`
- Create: `apps/api/src/modules/users/http.test.ts`
- Create: `apps/api/src/runtime.ts`
- Create: `apps/api/src/terminal-password.ts`
- Create: `apps/api/src/terminal-password.test.ts`
- Create: `apps/api/src/bootstrap-admin.ts`
- Create: `apps/api/src/bootstrap-admin.test.ts`
- Modify: `apps/api/src/app.ts`
- Modify: `apps/api/src/app.test.ts`
- Modify: `apps/api/src/config.ts`
- Modify: `apps/api/src/config.test.ts`
- Modify: `apps/api/src/server.ts`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`

**Interfaces:**
- Produces: 设计第 11 节全部 HTTP 路由和 `bootstrap-admin` 命令。
- Consumes: Tasks 2-5 的服务。

- [ ] **Step 1: Install the Fastify cookie plugin**

Run: `npm install @fastify/cookie --workspace @project-online/api`

Expected: 根 lockfile 更新，安装版本与 Fastify 5 兼容，`npm audit` 不新增已知漏洞。

- [ ] **Step 2: Write failing configuration tests**

扩展 `ApiConfig`：

```ts
interface ApiConfig {
  host: string;
  port: number;
  environment: AppEnvironment;
  webOrigin: string;
  authStorePath: string;
}
```

默认 `WEB_ORIGIN=http://127.0.0.1:5173`、`AUTH_STORE_PATH=.local-data/auth-store.json`。拒绝非 HTTP(S) origin、带 path/query/hash 的 origin 和空状态路径。

- [ ] **Step 3: Run config tests, implement parser, and verify GREEN**

Run: `npm run test -- --run apps/api/src/config.test.ts`

Expected: 首次因缺少字段失败；实现后全部通过。`.env.example` 只增加上述公开非敏感配置名和值。

- [ ] **Step 4: Write failing authentication HTTP tests**

使用 `app.inject` 和内存服务覆盖：激活、登录 Cookie、当前会话、刷新 Cookie 轮换、退出清 Cookie、修改密码、完成重置、错误码、额外请求字段拒绝和不匹配 Origin 返回 403。

生产 Cookie 断言：

```ts
expect(setCookie).toContain("__Host-id=");
expect(setCookie).toContain("HttpOnly");
expect(setCookie).toContain("Secure");
expect(setCookie).toContain("SameSite=Strict");
expect(setCookie).toContain("Path=/");
```

开发环境断言 Cookie 名为 `id` 且不含 `Secure`。

- [ ] **Step 5: Run auth HTTP tests and verify RED**

Run: `npm run test -- --run apps/api/src/modules/auth/http.test.ts`

Expected: FAIL，因为路由尚未注册。

- [ ] **Step 6: Implement auth routes and request hooks**

注册 `@fastify/cookie`。认证路由按设计第 11.1、11.2 节实现；Cookie 状态变更请求校验 `Origin === config.webOrigin`。受保护路由从 Cookie 调用 `authenticate`，不接受请求体中的 user ID 或角色。

为登录、激活、刷新、重置和修改密码响应设置 `Cache-Control: no-store`。Fastify Schema 全部 `additionalProperties: false`。

- [ ] **Step 7: Write failing user-management HTTP tests**

覆盖：管理员列表和开通成功、非管理员 403、无会话 401、停用、启用、角色变化、重新签发激活码、签发重置码、最后管理员保护，以及所有响应字段不包含 `passwordHash`、`tokenHash`、`ticketDigest`。

- [ ] **Step 8: Implement user routes and verify API**

Run:

```bash
npm run test -- --run apps/api/src/modules/auth/http.test.ts apps/api/src/modules/users/http.test.ts apps/api/src/app.test.ts
npm run typecheck --workspace @project-online/api
```

Expected: 健康检查保持兼容，认证和用户 API 测试全部通过。

- [ ] **Step 9: Write failing bootstrap tests**

将交互与逻辑分开：

```ts
export interface BootstrapPrompt {
  readUsername(): Promise<string>;
  readDisplayName(): Promise<string>;
  readHiddenPassword(label: string): Promise<string>;
}

export async function runBootstrapAdmin(
  prompt: BootstrapPrompt,
  userService: UserService
): Promise<void>;
```

测试使用运行时随机密码和捕获输出，断言两次输入不一致拒绝、已有用户拒绝、成功输出不包含密码或哈希。

- [ ] **Step 10: Implement cross-platform terminal bootstrap**

先在 `terminal-password.test.ts` 使用可控输入输出流验证：字符不回显、Backspace 删除一个字符、Ctrl+C 拒绝、正常完成和异常退出都恢复 raw mode。运行测试并确认因模块不存在而失败。

`terminal-password.ts` 要求 `stdin.isTTY`，使用 raw mode 读取，处理 Enter、Backspace 和 Ctrl+C，只输出提示和换行，不回显字符。`finally` 必须恢复 raw mode。`bootstrap-admin.ts` 加载同一 `AUTH_STORE_PATH`，创建服务并调用 `runBootstrapAdmin`。

更新脚本：

```json
{
  "bootstrap-admin": "tsx src/bootstrap-admin.ts",
  "build": "esbuild src/server.ts src/bootstrap-admin.ts --bundle --platform=node --format=esm --target=node22 --outdir=dist --sourcemap --external:fastify --external:@fastify/cookie"
}
```

- [ ] **Step 11: Compose runtime services and verify**

`runtime.ts` 只负责打开 `FileAuthStateStore`、创建一次 dummy 密码哈希并装配 Task 2-5 服务。`APP_ENV=production` 时必须在打开文件前拒绝启动，错误固定为“Production authentication store is not configured”。`server.ts` 在监听前完成装配；启动错误只输出安全消息，不序列化环境变量或状态内容。

Run:

```bash
npm run test -- --run apps/api/src
npm run typecheck --workspace @project-online/api
npm run build --workspace @project-online/api
npm audit
```

Expected: API 测试、类型检查和双入口构建通过，审计为 0 个已知漏洞。

- [ ] **Step 12: Commit API and bootstrap flow**

```bash
git add .env.example package.json package-lock.json apps/api
git commit -m "feat: expose M2 authentication and user APIs"
```

---

### Task 7: Build Web Login, Activation, and Session Views

**Files:**
- Create: `apps/web/src/api-client.ts`
- Create: `apps/web/src/features/auth/auth-client.ts`
- Create: `apps/web/src/features/auth/LoginView.tsx`
- Create: `apps/web/src/features/auth/SetPasswordView.tsx`
- Create: `apps/web/src/features/auth/AccountView.tsx`
- Create: `apps/web/src/features/auth/auth.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: `AuthClient`、`SessionUser` 和登录/激活/重置/账号视图。
- Consumes: Task 6 的认证 API；不读取 Cookie 内容。

- [ ] **Step 1: Write failing auth-client tests**

覆盖请求路径、JSON body、统一错误解析、204 空响应和 `credentials: "same-origin"`。客户端公开：

```ts
export interface AuthClient {
  getSession(): Promise<SessionUser | null>;
  login(username: string, password: string): Promise<void>;
  activate(ticket: string, password: string): Promise<void>;
  completeReset(ticket: string, password: string): Promise<void>;
  refresh(): Promise<void>;
  logout(): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
}
```

- [ ] **Step 2: Run client tests, implement, and verify GREEN**

Run: `npm run test -- --run apps/web/src/features/auth/auth.test.tsx`

Expected: 首次因模块缺失失败；实现客户端后客户端测试通过。

- [ ] **Step 3: Write failing login and self-set-password view tests**

覆盖：登录字段、提交中禁用、通用失败、成功回调、激活和重置模式标题、12 字符规则、两次密码不一致、提交后输入清空。测试密码运行时生成。

- [ ] **Step 4: Implement compact authentication views**

登录首屏直接呈现产品名和登录表单，不增加营销 Hero。激活和重置使用同一个 `SetPasswordView` 的显式 mode。密码使用标准 password input，提供 lucide 眼睛图标切换可见性并带 tooltip/aria-label。

- [ ] **Step 5: Write failing App session-state tests**

覆盖：启动检查会话、未登录显示登录、登录成功显示账号、401 回到登录、退出后清空身份、`ADMIN` 显示用户管理入口、`USER/LEADER` 不显示该入口。

- [ ] **Step 6: Implement the App state machine and responsive shell**

状态固定为 `checking | anonymous | authenticated | sessionExpired`。身份只保存在 React 内存；不得调用 `localStorage` 或 `sessionStorage`。保留 M1 系统版本和 API 状态为已登录工具栏中的紧凑信息。

- [ ] **Step 7: Verify and commit Web authentication**

Run:

```bash
npm run test -- --run apps/web/src/features/auth apps/web/src/App.test.tsx
npm run typecheck --workspace @project-online/web
npm run build --workspace @project-online/web
```

Expected: 登录、自设密码、会话恢复和角色视图测试通过。

```bash
git add apps/web/src
git commit -m "feat: add Web login and session experience"
```

---

### Task 8: Build Administrator User Management

**Files:**
- Create: `apps/web/src/features/admin-users/admin-users-client.ts`
- Create: `apps/web/src/features/admin-users/AdminUsersView.tsx`
- Create: `apps/web/src/features/admin-users/AdminUsersView.test.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces: 管理员用户列表、开通、启停、角色调整、重新激活和密码重置界面。
- Consumes: Task 6 用户 API、Task 7 会话身份。

- [ ] **Step 1: Write failing administrator interaction tests**

覆盖：加载用户列表、开通表单没有密码字段、开通后只显示一次激活码、关闭后不能恢复、待激活用户可重新签发、启停确认、角色菜单、签发重置码只显示一次、403 显示无权限、最后管理员错误显示明确提示。

- [ ] **Step 2: Run admin UI tests and verify RED**

Run: `npm run test -- --run apps/web/src/features/admin-users/AdminUsersView.test.tsx`

Expected: FAIL，因为管理员模块不存在。

- [ ] **Step 3: Implement the API client and user table**

表格列固定为显示名称、登录名、角色、账号状态、凭证状态、更新时间和操作菜单。窄屏使用可横向滚动的表格容器，不把每行转换成嵌套卡片。

开通账号对话框只含登录名、显示名称和角色。二次确认用于停用、角色变化和密码重置。所有命令成功后重新读取列表。

- [ ] **Step 4: Implement one-time credential display**

激活码或重置码仅保存在当前对话框组件状态；关闭对话框时设置为空。提供复制图标按钮和明确的“一次显示”状态，不把值写入 URL、日志、浏览器存储或错误对象。

- [ ] **Step 5: Verify and commit administrator UI**

Run:

```bash
npm run test -- --run apps/web/src/features/admin-users apps/web/src/App.test.tsx
npm run typecheck --workspace @project-online/web
npm run build --workspace @project-online/web
```

Expected: 管理员交互测试全部通过，普通用户视图无管理命令。

```bash
git add apps/web/src
git commit -m "feat: add administrator user management"
```

---

### Task 9: Complete Documentation and M2 Acceptance

**Files:**
- Modify: `README.md`
- Modify: `TO-do.md`
- Modify: `docs/architecture/domain-model.md`
- Modify: `docs/architecture/permission-matrix.md`
- Modify: `docs/superpowers/plans/2026-08-09-m2-auth-authorization.md`

**Interfaces:**
- Produces: 可执行的管理员初始化与 M2 开发说明、已验证待办状态。
- Consumes: Tasks 1-8 的真实命令、状态、路径和 API 行为。

- [ ] **Step 1: Update architecture documents**

在领域模型中把 `User` 的账号状态和凭证状态分开，增加一次性凭证和会话摘要字段；权限矩阵增加“账号启用且凭证就绪”的前置条件和管理员不能设置用户密码的规则。不得添加数据库表名或 SQL。

- [ ] **Step 2: Update README with exact local workflow**

增加以下顺序：

```bash
cp .env.example .env
npm ci
npm run bootstrap-admin --workspace @project-online/api
npm run dev
```

Windows 使用 `Copy-Item .env.example .env`。明确 `.local-data/auth-store.json` 是被忽略的单机开发数据，不得用于生产或提交；说明所有用户通过激活码自行设置密码。

- [ ] **Step 3: Update TO-do only after evidence exists**

只勾选通过自动化和浏览器验收的 M2.1、M2.2、M2.3 条目。未实现数据库、多实例、桌面凭证和项目业务保持未完成。

- [ ] **Step 4: Run clean installation and full verification**

Run:

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run test -- --run
npm run build
npm audit
git diff --check
```

Expected: 全部命令退出 0，测试 0 failures，npm audit 为 0 个已知漏洞。

- [ ] **Step 5: Run sensitive-data and storage-boundary checks**

使用运行时生成的临时状态完成测试后，确认：

```bash
git check-ignore apps/api/.local-data/auth-store.json
git status --short
```

Expected: 本地状态被忽略；仓储测试已经证明文件不含测试运行时生成的密码、会话令牌和一次性码。不得用终端命令打印本地状态文件内容。

- [ ] **Step 6: Perform browser acceptance**

流程固定为：初始化临时管理员并登录 → 开通普通用户 → 普通用户使用激活码自行设置密码 → 普通用户登录 → 普通用户访问管理员用户接口得到 403 → 管理员停用普通用户 → 普通用户旧会话变为 401。

在 1440×900 和 390×844 视口验证无横向溢出、文字重叠或未处理控制台错误。一次性码在关闭对话框后不可恢复。浏览器联调不得展示或记录实际密码、Cookie 或完整一次性码。

- [ ] **Step 7: Commit M2 documentation and completion record**

```bash
git add README.md TO-do.md docs/architecture docs/superpowers/plans/2026-08-09-m2-auth-authorization.md
git commit -m "docs: complete M2 authentication workflow"
```

- [ ] **Step 8: Final branch check**

Run:

```bash
git status --short
git log --oneline --max-count=12
```

Expected: 工作树干净；设计、领域、密码、存储、服务、API、Web 和文档均有独立提交。
