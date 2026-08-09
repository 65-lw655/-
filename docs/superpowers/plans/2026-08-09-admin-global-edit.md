# Admin Global Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将已确认的管理员全局新增、修改和逻辑删除权限同步到 M0 主文档，并消除管理员必须加入项目才能编辑的旧口径。

**Architecture:** 本次只修改权限设计文档，不创建业务代码或数据库逻辑。服务端授权口径调整为 `ADMIN` 绕过项目成员写权限检查，但仍执行账号、会话、项目状态、输入校验和专项敏感操作检查。

**Tech Stack:** Markdown、Git、ripgrep

## Global Constraints

- 管理员无需成为项目成员即可查看、新增、修改和逻辑删除全部项目业务记录。
- 领导保持全部项目只读，写入仍要求项目成员权限。
- 普通用户继续按项目成员关系获得读取和写入权限。
- 单项目完整导出继续使用受控流程。
- 永久物理删除不提供普通业务接口。
- 生产审计记录不能由普通管理员修改或删除。
- 不连接或查询数据库，不编写 SQL。
- 不在文档、代码或日志中记录任何密码、密钥、令牌或真实敏感信息。

---

### Task 1: 统一管理员全局编辑权限文档

**Files:**
- Modify: `README.md:29-35`
- Modify: `README.md:230-240`
- Modify: `TO-do.md:23-29`
- Modify: `TO-do.md:77-82`
- Modify: `TO-do.md:204-212`
- Modify: `TO-do.md:232-238`
- Modify: `TO-do.md:470-478`
- Modify: `docs/architecture/permission-matrix.md:7-163`
- Reference: `docs/superpowers/specs/2026-08-09-admin-global-edit-design.md`

**Interfaces:**
- Consumes: 已确认的系统角色 `USER`、`LEADER`、`ADMIN` 和项目角色 `OWNER`、`EDITOR`、`VIEWER`。
- Produces: 后续 API 授权中唯一一致的管理员全局写入规则和可直接转换为自动化测试的权限示例。

- [x] **Step 1: 记录修改前会失败的一致性检查**

Run:

```bash
rg -n '管理员.*全部项目只读|管理员默认不具有.*业务编辑权限|管理员修改未参与项目的回款金额.*拒绝|全局查看权不隐式扩大为全局编辑权|管理员必须.*项目.*才能编辑' README.md TO-do.md docs/architecture/permission-matrix.md
```

Expected: 至少匹配 `permission-matrix.md` 中的旧角色范围、旧示例和旧验收口径，证明文档尚未满足已确认设计。

- [x] **Step 2: 修改产品范围和路线图**

在 `README.md` 中明确管理员可全局新增、修改和逻辑删除业务数据，并在验收条件中区分领导全局查询与管理员全局编辑。

在 `TO-do.md` 中修改全局约束、M0 权限任务、M2 授权任务、项目闭环任务和最终权限验收项，删除“管理员默认仅查看”的旧要求。

- [x] **Step 3: 修改权限矩阵和 API 映射**

在 `docs/architecture/permission-matrix.md` 中执行以下精确调整：

- `ADMIN` 默认数据范围改为全部项目可读写。
- 权限判定顺序允许 `ADMIN` 绕过项目成员写入检查。
- 管理员非成员列对业务资源改为 `RCUD`，项目基础资料为 `RCU`，项目成员为 `RCMUD`。
- 管理员可以归档和恢复项目，但永久删除仍不开放。
- 编辑项目资料和子记录的 API 最低要求增加 `ADMIN`。
- 将“管理员修改未参与项目回款”示例改为允许并记录审计。
- 验收项明确管理员全局编辑是系统角色的显式例外。

- [x] **Step 4: 执行旧口径清理检查**

Run:

```bash
rg -n '管理员.*全部项目只读|管理员默认不具有.*业务编辑权限|管理员修改未参与项目的回款金额.*拒绝|全局查看权不隐式扩大为全局编辑权|管理员必须.*项目.*才能编辑' README.md TO-do.md docs/architecture/permission-matrix.md
```

Expected: 无匹配。

- [x] **Step 5: 执行新口径与结构验证**

Run:

```bash
rg -n '管理员.*全局|`ADMIN`.*写|管理员.*逻辑删除' README.md TO-do.md docs/architecture/permission-matrix.md
git diff --check
```

Expected: 三份主文档均包含管理员全局写入规则，且 `git diff --check` 无输出、退出码为 0。权限示例保持至少 12 个，领导只读和完整导出受控规则仍存在。

- [x] **Step 6: 提交文档变更**

```bash
git add README.md TO-do.md docs/architecture/permission-matrix.md
git commit -m "docs: grant admins global project edit access"
```

Expected: 只提交上述三份主文档，不混入设计说明或其他无关文件。
