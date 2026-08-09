# M1 Engineering Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 npm workspaces 单仓库，并交付共享版本、Fastify 健康检查和 React API 连通状态的最小可运行链路。

**Architecture:** 根工作区统一管理 TypeScript、ESLint、Prettier、Vitest 和构建命令。`packages/domain` 提供唯一系统版本；Fastify API 通过 `/api/v1/health` 暴露该版本；React Web 读取公开配置并显示 API 的检查、成功或失败状态。桌面、UI 和同步包在 M1 只建立可构建边界。

**Tech Stack:** Node.js 22、npm 10、TypeScript、React、Vite、Fastify、Vitest、Testing Library、ESLint、Prettier、tsup

## Global Constraints

- 不连接或查询 PostgreSQL、SQLite 或任何数据库，不编写 SQL。
- 不实现账号、权限、项目业务、离线同步、对象存储或 Tauri 功能。
- 不在源码、日志、文档、测试或示例环境文件中写入密码、令牌、密钥、证书或真实业务数据。
- `apps/desktop` 只提供 TypeScript 工作区骨架，不声称支持离线或系统集成。
- Web 使用相对 API 地址 `/api`，开发代理指向本机 API；不添加生产云地址。
- API 与 Web 的系统版本必须直接来自 `@project-online/domain`。
- 所有手工文件修改使用 `apply_patch`；依赖清单和锁文件允许由 npm 维护。
- 每个任务完成后运行任务指定验证并单独提交。

---

### Task 1: 建立根工具链和工作区清单

**Files:**
- Create: `package.json`
- Create: `package-lock.json`（由 npm 生成）
- Create: `tsconfig.base.json`
- Create: `eslint.config.js`
- Create: `.prettierrc.json`
- Create: `.prettierignore`
- Create: `.env.example`
- Create: `vitest.config.ts`
- Modify: `.gitignore`
- Create: `packages/domain/package.json`
- Create: `packages/domain/tsconfig.json`
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/sync/package.json`
- Create: `packages/sync/tsconfig.json`
- Create: `apps/api/package.json`
- Create: `apps/api/tsconfig.json`
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`

**Interfaces:**
- Consumes: Node.js 22 和 npm 10。
- Produces: 后续任务可用的工作区名称、统一脚本、编译选项和测试运行器。

- [ ] **Step 1: 创建根工作区清单**

根 `package.json` 必须包含以下结构；依赖字段由本任务 Step 4 的 npm 命令补齐：

```json
{
  "name": "project-online",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "packageManager": "npm@10.9.2",
  "engines": { "node": ">=22.12 <23" },
  "workspaces": [
    "packages/domain",
    "packages/ui",
    "packages/sync",
    "apps/api",
    "apps/web",
    "apps/desktop"
  ],
  "scripts": {
    "dev": "npm run build --workspace @project-online/domain && concurrently -n api,web -c cyan,green \"npm run dev --workspace @project-online/api\" \"npm run dev --workspace @project-online/web\"",
    "lint": "eslint . --max-warnings=0",
    "format:check": "prettier --check .",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "vitest",
    "build": "npm run build --workspaces --if-present"
  }
}
```

- [ ] **Step 2: 创建 TypeScript、lint、格式和测试配置**

`tsconfig.base.json` 使用 `ES2022`、`ESNext`、`Bundler`、`strict`、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`、`isolatedModules` 和 `skipLibCheck`。各工作区 `tsconfig.json` 继承根配置，包含自己的 `src`，并按 React 或 Node 场景声明类型。

`eslint.config.js` 组合 `@eslint/js`、`typescript-eslint`、React Hooks 和 React Refresh 推荐规则，忽略 `dist`、`coverage` 和工作树目录。`vitest.config.ts` 默认使用 Node 环境，并匹配 `apps/**` 与 `packages/**` 下的 `*.test.ts`、`*.test.tsx`。

- [ ] **Step 3: 创建工作区清单**

包名固定为：

```text
@project-online/domain
@project-online/ui
@project-online/sync
@project-online/api
@project-online/web
@project-online/desktop
```

API 和 Web 的 `dependencies` 都声明 `"@project-online/domain": "*"`。API 脚本使用 `tsx watch` 开发、`tsup` 构建；Web 使用 Vite；共享包和桌面骨架使用 `tsc` 构建。

- [ ] **Step 4: 安装并锁定依赖**

Run:

```bash
npm install --save-dev typescript vitest jsdom eslint @eslint/js typescript-eslint eslint-plugin-react-hooks eslint-plugin-react-refresh globals prettier tsx tsup concurrently vite @vitejs/plugin-react @testing-library/react @testing-library/dom @testing-library/jest-dom @types/node @types/react @types/react-dom
npm install fastify --workspace @project-online/api
npm install react react-dom lucide-react --workspace @project-online/web
```

Expected: 生成唯一根 `package-lock.json`；`npm ls --workspaces --depth=0` 退出 0。

- [ ] **Step 5: 完善安全忽略规则和示例配置**

`.env.example` 只包含：

```dotenv
APP_ENV=development
API_HOST=127.0.0.1
API_PORT=3000
VITE_API_BASE_URL=/api
```

`.gitignore` 必须覆盖 `.env`、`.env.*`（保留 `.env.example`）、`node_modules`、`dist`、`coverage`、`.DS_Store`、证书与私钥扩展名、数据库文件、Tauri/Rust 构建目录、桌面缓存和安装包。

- [ ] **Step 6: 验证并提交工具链**

Run:

```bash
npm ls --workspaces --depth=0
git diff --check
```

Expected: 两条命令均退出 0。

```bash
git add package.json package-lock.json tsconfig.base.json eslint.config.js .prettierrc.json .prettierignore .env.example vitest.config.ts .gitignore apps packages
git commit -m "build: establish M1 workspace toolchain"
```

---

### Task 2: 建立共享版本和占位包边界

**Files:**
- Create: `packages/domain/src/index.test.ts`
- Create: `packages/domain/src/index.ts`
- Create: `packages/ui/src/index.ts`
- Create: `packages/sync/src/index.ts`
- Create: `apps/desktop/src/index.ts`

**Interfaces:**
- Produces: `SYSTEM_VERSION: "0.1.0"`、`UI_PACKAGE_NAME`、`SYNC_PACKAGE_NAME`、`DESKTOP_APP_ID`。
- Consumes: Task 1 的 TypeScript 和 Vitest 配置。

- [ ] **Step 1: 写共享版本失败测试**

```ts
import { describe, expect, it } from "vitest";
import { SYSTEM_VERSION } from "./index.js";

describe("SYSTEM_VERSION", () => {
  it("uses the M1 baseline version", () => {
    expect(SYSTEM_VERSION).toBe("0.1.0");
  });
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test -- --run packages/domain/src/index.test.ts`

Expected: FAIL，原因是 `packages/domain/src/index.ts` 不存在。

- [ ] **Step 3: 实现最小共享入口**

```ts
export const SYSTEM_VERSION = "0.1.0" as const;
```

其他骨架入口分别导出固定包标识，不包含业务逻辑。

- [ ] **Step 4: 验证共享包和骨架**

Run:

```bash
npm run test -- --run packages/domain/src/index.test.ts
npm run typecheck --workspace @project-online/domain
npm run typecheck --workspace @project-online/ui
npm run typecheck --workspace @project-online/sync
npm run typecheck --workspace @project-online/desktop
npm run build --workspace @project-online/domain
npm run build --workspace @project-online/ui
npm run build --workspace @project-online/sync
npm run build --workspace @project-online/desktop
```

Expected: 1 个测试通过；所有工作区类型检查和构建退出 0。

- [ ] **Step 5: 提交**

```bash
git add packages/domain/src packages/ui/src packages/sync/src apps/desktop/src
git commit -m "feat: add shared workspace entry points"
```

---

### Task 3: 实现 API 配置解析

**Files:**
- Create: `apps/api/src/config.test.ts`
- Create: `apps/api/src/config.ts`

**Interfaces:**
- Produces: `AppEnvironment`、`ApiConfig`、`parseApiConfig(env)`。
- Consumes: 无外部服务；输入仅为显式传入的环境变量记录。

- [ ] **Step 1: 写配置失败测试**

测试必须覆盖：空输入得到 `127.0.0.1:3000` 和 `development`；合法自定义值被解析；端口为非整数、越界或环境枚举无效时抛出固定配置错误。

```ts
expect(parseApiConfig({})).toEqual({
  host: "127.0.0.1",
  port: 3000,
  environment: "development"
});
expect(() => parseApiConfig({ API_PORT: "invalid" })).toThrow(
  "API_PORT must be an integer between 1 and 65535"
);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test -- --run apps/api/src/config.test.ts`

Expected: FAIL，原因是 `config.ts` 不存在。

- [ ] **Step 3: 实现最小解析器**

`parseApiConfig` 不读取环境变量全集、不记录输入值，只返回校验后的 `host`、`port`、`environment`。允许的环境值固定为 `development`、`test`、`production`。

```ts
export type AppEnvironment = "development" | "test" | "production";

export interface ApiConfig {
  host: string;
  port: number;
  environment: AppEnvironment;
}

export function parseApiConfig(
  env: Readonly<Record<string, string | undefined>>
): ApiConfig {
  const port = Number(env.API_PORT ?? "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("API_PORT must be an integer between 1 and 65535");
  }

  const environment = env.APP_ENV ?? "development";
  if (!isAppEnvironment(environment)) {
    throw new Error("APP_ENV must be development, test, or production");
  }

  return {
    host: env.API_HOST?.trim() || "127.0.0.1",
    port,
    environment
  };
}
```

- [ ] **Step 4: 验证并提交**

Run:

```bash
npm run test -- --run apps/api/src/config.test.ts
npm run typecheck --workspace @project-online/api
```

Expected: 配置测试全部通过，API 类型检查退出 0。

```bash
git add apps/api/src/config.ts apps/api/src/config.test.ts
git commit -m "feat: validate API runtime configuration"
```

---

### Task 4: 实现 Fastify 健康检查

**Files:**
- Create: `apps/api/src/app.test.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/server.ts`
- Create: `apps/api/tsup.config.ts`

**Interfaces:**
- Produces: `buildApp(config)` 和 `GET /api/v1/health`。
- Consumes: Task 2 的 `SYSTEM_VERSION` 和 Task 3 的 `ApiConfig`。

- [ ] **Step 1: 写健康检查失败测试**

```ts
const app = buildApp({
  host: "127.0.0.1",
  port: 3000,
  environment: "test"
});
const response = await app.inject({ method: "GET", url: "/api/v1/health" });

expect(response.statusCode).toBe(200);
expect(response.json()).toEqual({
  status: "ok",
  service: "api",
  environment: "test",
  systemVersion: SYSTEM_VERSION
});
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test -- --run apps/api/src/app.test.ts`

Expected: FAIL，原因是 `app.ts` 不存在。

- [ ] **Step 3: 实现应用工厂和 Schema**

`buildApp` 创建 Fastify 实例并注册健康检查。响应 Schema 固定四个必需字段并禁止额外字段。测试结束调用 `app.close()`。

```ts
export function buildApp(config: ApiConfig): FastifyInstance {
  const app = fastify({ logger: config.environment !== "test" });
  app.get("/api/v1/health", { schema: healthSchema }, async () => ({
    status: "ok",
    service: "api",
    environment: config.environment,
    systemVersion: SYSTEM_VERSION
  }));
  return app;
}
```

- [ ] **Step 4: 实现启动入口**

`server.ts` 调用 `parseApiConfig(process.env)`、`buildApp(config)` 和 `app.listen`。启动失败只输出安全、可理解的错误消息并设置非零退出码，不输出环境变量全集。

```ts
async function start(): Promise<void> {
  const config = parseApiConfig(process.env);
  const app = buildApp(config);
  await app.listen({ host: config.host, port: config.port });
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`API failed to start: ${message}\n`);
  process.exitCode = 1;
});
```

- [ ] **Step 5: 验证并提交**

Run:

```bash
npm run test -- --run apps/api/src
npm run typecheck --workspace @project-online/api
npm run build --workspace @project-online/api
```

Expected: API 测试、类型检查和构建全部通过。

```bash
git add apps/api/src apps/api/tsup.config.ts
git commit -m "feat: add versioned API health check"
```

---

### Task 5: 实现 Web 配置和健康客户端

**Files:**
- Create: `apps/web/src/config.test.ts`
- Create: `apps/web/src/config.ts`
- Create: `apps/web/src/health-client.test.ts`
- Create: `apps/web/src/health-client.ts`

**Interfaces:**
- Produces: `resolveWebConfig(apiBaseUrl)` 和 `checkApiHealth(config, fetchImpl)`。
- Consumes: Task 2 的 `SYSTEM_VERSION` 和 API 健康响应契约。

- [ ] **Step 1: 写 Web 配置失败测试**

覆盖缺失、空白、相对 `/api`、绝对 HTTPS 地址和末尾斜杠规范化。缺失配置返回明确的判别联合，不抛出异常。

```ts
expect(resolveWebConfig(undefined)).toEqual({
  ok: false,
  message: "API 地址未配置"
});
expect(resolveWebConfig("/api/")).toEqual({
  ok: true,
  apiBaseUrl: "/api"
});
```

- [ ] **Step 2: 写健康客户端失败测试**

通过注入的 `fetchImpl` 覆盖成功、网络异常、非 200、响应结构无效和版本不一致。成功结果必须包含服务名和共享版本。

- [ ] **Step 3: 运行测试并确认失败**

Run: `npm run test -- --run apps/web/src/config.test.ts apps/web/src/health-client.test.ts`

Expected: FAIL，原因是两个实现文件不存在。

- [ ] **Step 4: 实现配置和健康客户端**

客户端只请求 `${apiBaseUrl}/v1/health`。响应先做结构判断，再比较 `systemVersion === SYSTEM_VERSION`；不得用类型断言跳过运行时检查。

```ts
export type WebConfigResult =
  | { ok: true; apiBaseUrl: string }
  | { ok: false; message: "API 地址未配置" | "API 地址格式无效" };

export function resolveWebConfig(apiBaseUrl: string | undefined): WebConfigResult;

export type HealthResult =
  | { ok: true; service: string; systemVersion: string }
  | { ok: false; reason: "network" | "response" | "version"; message: string };

export async function checkApiHealth(
  apiBaseUrl: string,
  fetchImpl: typeof fetch = fetch
): Promise<HealthResult>;
```

- [ ] **Step 5: 验证并提交**

Run:

```bash
npm run test -- --run apps/web/src/config.test.ts apps/web/src/health-client.test.ts
npm run typecheck --workspace @project-online/web
```

Expected: Web 配置与客户端测试全部通过。

```bash
git add apps/web/src/config.ts apps/web/src/config.test.ts apps/web/src/health-client.ts apps/web/src/health-client.test.ts
git commit -m "feat: add Web API health client"
```

---

### Task 6: 实现 React 开发状态页

**Files:**
- Create: `apps/web/index.html`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/vite-env.d.ts`
- Create: `apps/web/src/main.tsx`
- Create: `apps/web/src/App.test.tsx`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/styles.css`

**Interfaces:**
- Produces: 浏览器开发状态页和 Vite `/api` 代理。
- Consumes: Task 5 的配置与健康客户端、Task 2 的共享版本。

- [ ] **Step 1: 写组件失败测试**

使用 jsdom 和 Testing Library 覆盖：

- 缺少 API 地址时显示“API 地址未配置”且 `fetch` 调用次数为 0。
- 成功响应后显示“已连接”、`api` 和共享版本。
- 网络失败显示“连接失败”。
- 版本不一致显示“版本不一致”。

- [ ] **Step 2: 运行测试并确认失败**

Run: `npm run test -- --run apps/web/src/App.test.tsx`

Expected: FAIL，原因是 `App.tsx` 不存在。

- [ ] **Step 3: 实现状态组件**

`App` 允许测试注入 `apiBaseUrl`、`environment` 和 `fetchImpl`，生产默认值来自 `import.meta.env`。组件状态固定为配置缺失、检查中、已连接和连接失败；不增加无限重试。

```ts
export interface AppProps {
  apiBaseUrl?: string;
  environment?: string;
  fetchImpl?: typeof fetch;
}

export function App({
  apiBaseUrl = import.meta.env.VITE_API_BASE_URL,
  environment = import.meta.env.MODE,
  fetchImpl = fetch
}: AppProps): JSX.Element;
```

- [ ] **Step 4: 实现内部工具样式和 Vite 代理**

页面采用浅色中性底色、紧凑标题、单层状态面板和绿色/黄色/红色状态，不使用营销 Hero、渐变或嵌套卡片。图标使用 `lucide-react`。Vite 根环境目录指向仓库根，并将 `/api` 代理到 `http://127.0.0.1:3000`。

- [ ] **Step 5: 验证并提交**

Run:

```bash
npm run test -- --run apps/web/src
npm run typecheck --workspace @project-online/web
npm run build --workspace @project-online/web
```

Expected: Web 测试、类型检查和构建全部通过。

```bash
git add apps/web
git commit -m "feat: show Web API connection status"
```

---

### Task 7: 补齐 CI、README 和 M1 验收

**Files:**
- Create: `.github/workflows/verify.yml`
- Modify: `README.md`
- Modify: `TO-do.md`

**Interfaces:**
- Produces: 新机器开发说明、CI 验证和 M1 完成记录。
- Consumes: Tasks 1-6 的真实命令和运行端口。

- [ ] **Step 1: 创建 CI**

工作流在 push 和 pull request 运行，使用 `actions/checkout@v4`、`actions/setup-node@v4`、Node.js 22 和 npm 缓存，依次执行：

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run test -- --run
npm run build
```

- [ ] **Step 2: 更新 README**

增加：Node/npm 前提、macOS/Linux 与 Windows 创建 `.env` 的命令、`npm ci`、`npm run dev`、Web `http://127.0.0.1:5173`、API `http://127.0.0.1:3000/api/v1/health`、统一验证命令、工作区职责和 M1 未实现范围。

- [ ] **Step 3: 更新 TO-do**

只勾选实际通过验证的 M1.1、M1.2 条目和 M1 出口，不勾选 M2 及后续任务。

- [ ] **Step 4: 运行完整验收**

Run:

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run test -- --run
npm run build
git diff --check
```

Expected: 所有命令退出 0，测试输出 0 failures。

- [ ] **Step 5: 启动并做浏览器验证**

基于 `.env.example` 创建本机 `.env`（保持忽略），运行 `npm run dev`。验证健康检查返回约定 JSON；在桌面和移动视口检查页面无重叠、状态可见、API 已连接。停止 API 后重新加载页面，应显示连接失败。

- [ ] **Step 6: 提交**

```bash
git add .github/workflows/verify.yml README.md TO-do.md
git commit -m "docs: complete M1 developer workflow"
```

- [ ] **Step 7: 最终检查**

Run:

```bash
git status --short
git log --oneline --max-count=8
```

Expected: 工作树干净；M1 每个可验收任务有独立提交。
