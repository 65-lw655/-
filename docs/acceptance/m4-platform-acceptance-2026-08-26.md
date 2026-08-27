# M4 平台验收记录（2026-08-26）

## macOS 本机门禁

在 macOS ARM64 环境执行并通过：

- `npm run verify:desktop`：11 个测试文件、57 个测试通过。
- `cargo test --locked --manifest-path apps/desktop/src-tauri/Cargo.toml`：17 个 Rust 单元测试、3 个集成测试通过。
- `cargo clippy --locked --manifest-path apps/desktop/src-tauri/Cargo.toml -- -D warnings`：通过。
- `npm run build:desktop --workspace @project-online/desktop`：Tauri debug no-bundle 构建通过。

本机 SQLite 持久化、Outbox 写入、重启后状态保持由临时 SQLite Rust 测试覆盖；未读取或修改现有应用数据库。

## Windows 门禁

`.github/workflows/desktop-verify.yml` 已配置 `windows-latest` 矩阵，包含前端门禁、Rust 测试、Clippy 和 Tauri debug no-bundle 构建。当前仓库没有远程 CI 运行证据，且本次验收环境为 macOS，因此 Windows 实机/CI 结果仍需在 GitHub Actions 中运行后确认，不能在本地宣称通过。

2026-08-27 已在 GitHub Actions 实跑确认：

- `Desktop (windows-latest)`：前端门禁、Rust 测试、Clippy、Tauri debug no-bundle 构建全部通过。
- `Desktop (macos-latest)`：同一矩阵全部通过。
- 运行记录：[Desktop Verify #33054114850](https://github.com/65-lw655/-/actions/runs/33054114850)

Windows CI 门禁已关闭，M4 平台验收完成。
