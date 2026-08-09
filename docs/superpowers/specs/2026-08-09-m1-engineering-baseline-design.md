# M1 工程基线与最小运行链路设计

- 日期：2026-08-09
- 状态：待书面复核
- 里程碑：M1

## 1. 目标

建立可持续开发的 npm workspaces 单仓库，并跑通“共享领域版本 → Fastify API 健康检查 → React Web 连通状态”的最小链路。新开发环境仅依据 README 即可安装依赖、启动 Web 和 API，并完成统一检查、测试和构建。

## 2. 本期范围

M1 包含：

- 根目录 npm workspaces、TypeScript 严格模式、ESLint、Prettier 和 Vitest。
- React + Vite Web 开发状态页。
- Fastify API 和版本化健康检查接口。
- Web、API 共用的领域版本常量。
- `apps/desktop`、`packages/ui`、`packages/sync` 的可构建工作区骨架。
- 不含敏感值的环境变量示例。
- lint、格式、类型、测试、构建命令和 CI 工作流。

M1 不包含：

- PostgreSQL、SQLite、数据库迁移或任何数据库连接。
- 账号登录、项目权限和业务数据接口。
- Tauri、Rust、桌面安装包和操作系统集成。
- 离线同步实现、对象存储和国内云生产资源。

## 3. 工程结构

```text
项目管理线上版/
├── apps/
│   ├── api/          # Fastify 应用、配置和健康检查
│   ├── web/          # React/Vite 开发状态页
│   └── desktop/      # M1 可构建占位包，后续接入 Tauri
├── packages/
│   ├── domain/       # 系统版本和共享领域入口
│   ├── ui/           # M1 可构建共享 UI 入口
│   └── sync/         # M1 可构建同步协议入口
├── .github/workflows/verify.yml
├── .env.example
├── package.json
├── package-lock.json
└── tsconfig.base.json
```

每个工作区拥有独立 `package.json` 和 `tsconfig.json`。共享包只导出本阶段真实需要的最小入口，不提前建立业务抽象。

## 4. 运行时与工具链

- Node.js 基线为 22，根 `package.json` 使用 `engines` 声明兼容要求。
- npm 负责工作区依赖和唯一锁文件，不混用其他包管理器。
- TypeScript 开启 `strict`、`noUncheckedIndexedAccess` 和一致的 ESM 配置。
- ESLint 检查 TypeScript 和 React；Prettier 只执行格式检查，不在验证命令中自动改文件。
- Vitest 负责共享包、API 和 Web 测试。
- 根脚本统一提供 `dev`、`lint`、`format:check`、`typecheck`、`test` 和 `build`。
- 根 `dev` 使用跨平台进程工具同时启动 API 和 Web，确保 Windows 开发环境可用。

## 5. 共享领域版本

`packages/domain` 导出：

```ts
export const SYSTEM_VERSION = "0.1.0" as const;
```

API 的健康检查响应和 Web 状态页都直接导入该常量。测试必须证明两个应用使用的是同一值，不能各自维护版本字符串。

## 6. API 设计

### 6.1 应用边界

API 分为两个入口：

- `buildApp(config)`：构造 Fastify 实例，供测试通过 `app.inject()` 使用，不监听端口。
- `start()`：解析环境配置并启动监听，只由开发或生产启动命令调用。

该边界使路由测试不占用真实网络端口，也不依赖数据库或外部服务。

### 6.2 健康检查

接口：`GET /api/v1/health`

成功响应状态码为 `200`：

```json
{
  "status": "ok",
  "service": "api",
  "environment": "development",
  "systemVersion": "0.1.0"
}
```

响应使用 Fastify Schema 约束。M1 健康检查只证明 API 进程和共享包可用，不伪装数据库、对象存储或同步服务已经就绪。

### 6.3 API 配置

- `API_HOST`：开发默认 `127.0.0.1`。
- `API_PORT`：开发默认 `3000`，必须是有效端口。
- `APP_ENV`：允许 `development`、`test`、`production`，开发默认 `development`。

非法值必须在监听前返回可理解的配置错误。日志不能输出环境变量全集或任何敏感值。

## 7. Web 设计

### 7.1 页面内容

首屏是实际开发状态页，不制作营销落地页。页面显示：

- 产品名“项目管理线上版”。
- 当前应用环境。
- 共享系统版本。
- API 状态：检查中、已连接、连接失败或配置缺失。
- API 返回的服务名和版本；版本不一致时显示明确异常状态。

界面采用安静、紧凑、适合内部工具的布局；不使用装饰性大卡片、渐变或无关插画。

### 7.2 Web 配置

Web 从 `VITE_API_BASE_URL` 读取 API 基地址。开发示例为 `/api`，Vite 将其代理到 `http://127.0.0.1:3000`。

配置缺失时不发出网络请求，页面显示“API 地址未配置”。配置解析函数独立测试，不读取或展示任何其他环境变量。

### 7.3 状态流

1. 页面加载并解析公开的 Web 配置。
2. 配置有效时请求 `${VITE_API_BASE_URL}/v1/health`。
3. 请求成功且版本一致时显示已连接。
4. 网络错误、非 200 响应、响应结构错误或版本不一致时显示对应失败状态。
5. 页面不自动无限重试；用户可通过刷新重新检查，后续业务阶段再增加统一重试策略。

## 8. 桌面与共享包骨架

`apps/desktop` 在 M1 只提供工作区清单、TypeScript 配置和一个平台标识入口，用于证明单仓库结构可构建。它不伪装已经具备 Tauri、离线或 Windows/macOS 原生能力。

`packages/ui` 和 `packages/sync` 只提供最小入口和包边界。M1 不创建组件库、同步队列或协议实现；这些内容分别在实际使用里程碑中通过测试驱动加入。

## 9. 测试设计

至少覆盖：

- `packages/domain`：`SYSTEM_VERSION` 等于基线版本。
- API：健康检查返回 200、固定响应结构、当前环境和共享版本。
- API：非法端口或环境值在启动前被拒绝。
- Web：缺少 `VITE_API_BASE_URL` 时返回配置错误且不请求网络。
- Web：健康检查成功时显示已连接和共享版本。
- Web：网络失败、响应无效或版本不一致时显示失败状态。
- Desktop、UI、Sync：最小入口通过 TypeScript 构建，不额外声称功能完成。

测试使用完全虚构的配置和响应，不包含真实账号、地址、令牌或业务数据。

## 10. CI 与完成标准

CI 使用 Node.js 22，并执行：

```bash
npm ci
npm run lint
npm run format:check
npm run typecheck
npm run test -- --run
npm run build
```

完成标准：

- 上述命令在干净工作树中全部退出 0。
- README 包含真实可执行的安装、启动、验证和目录说明。
- `.env.example` 只包含安全示例值，`.gitignore` 覆盖环境文件、证书、数据库文件、桌面缓存、安装包和构建产物。
- 启动后浏览器页面能显示 API 已连接；停止 API 后能显示连接失败。
- API 和 Web 显示的系统版本来自同一共享常量。
- M1 没有数据库连接、SQL、真实凭证或未要求的业务功能。
