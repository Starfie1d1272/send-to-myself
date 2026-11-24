# 版本管理

核心（根、`apps/api`、`apps/web` 和镜像）、桌面和鸿蒙独立版本，遵循[语义化版本](https://semver.org/lang/zh-CN/)。GitHub Releases 为各平台构件、镜像 digest 与校验摘要的唯一权威入口。

| 组件 | 版本来源 | 触发 tag 与自动发布行为 |
|---|---|---|
| 核心 | 根、`apps/api`、`apps/web` 的 `package.json` | 推送 `v<x.y.z>`：校验版本并构建多架构镜像，正式版同步更新 `:latest` 与 GitHub `Latest` Release，附 NAS 运维 ZIP |
| 桌面 | `apps/desktop/package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock` | 推送 `desktop-v<x.y.z>`：构建 Windows x64 与 Apple Silicon 安装包并创建 `Desktop <x.y.z>` Release（不覆盖 `Latest`） |
| 鸿蒙 | `SendToMyself/AppScope/app.json5` 的 `versionName` / `versionCode` | 推送 `harmony-v<x.y.z>`：构建未签名 HAP 并创建 `HarmonyOS <x.y.z>` Release（不覆盖 `Latest`）；`workflow_dispatch` 供手动验证 |

## 发版流程（单 PR + 推 tag）

1. 在发布分支更新目标组件版本文件（鸿蒙同时递增 `versionCode`），并在 [CHANGELOG.md](../CHANGELOG.md) 填写 `## [core-<版本>]` / `## [desktop-<版本>]` / `## [harmony-<版本>]` 变更说明。
2. 合并该 PR 到 `main` 并等待 CI 通过。
3. 基于 `main` 推送对应 tag（`v<版本>`、`desktop-v<版本>`、`harmony-v<版本>`），由 GitHub Actions 自动完成构建、校验与 Release 发布。

## 入口与兼容性原则

- [README.md](../README.md) 与 Web 端 [client-releases.ts](../apps/web/src/config/client-releases.ts) 使用稳定入口（Core 指向 `releases/latest` 与 `:latest`，桌面与鸿蒙分别指向 `releases?q=Desktop` 与 `releases?q=HarmonyOS`），**发版后无需再额外提 PR 更新下载链接**。
- 已有正式 tag 不覆盖或改写；设备覆盖安装鸿蒙时需确保 `versionCode` 递增；不公开设备绑定的签名证书或密码。
- 升级前按 [部署指南](DEPLOY.md#备份与恢复) 备份完整 `data` 目录与配置；回退需配合升级前备份与对应旧版本镜像。
