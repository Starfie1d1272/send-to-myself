# 版本管理

本仓库是 monorepo，含**核心**与多个**平台壳**，两者版本**独立管理**。

## 总原则

- 遵循[语义化版本](https://semver.org/lang/zh-CN/) `MAJOR.MINOR.PATCH`。
- **核心**（`apps/api` + `apps/web` + Docker 镜像）共用一个版本号。
- **平台壳**各自独立版本——壳是薄壳，业务全在服务端（[SPEC §14](SPEC.md)）。核心升级不必重发壳，壳升级也不动核心，发布节奏天然不同。

## 各部分版本写在哪

| 部分 | 版本来源 | 当前 |
|---|---|---|
| 核心（api / web / 根） | `package.json` 的 `version` | 1.0.0 |
| 桌面壳（Tauri） | `apps/desktop/src-tauri/tauri.conf.json` + `Cargo.toml` 的 `version` | 1.0.0 |
| 鸿蒙壳（ArkTS） | `SendToMyself/AppScope/app.json5` 的 `versionName` / `versionCode` | 1.0.0 |

## Git Tag 与发布

| 发布对象 | Tag 格式 | 触发的 CI | 产物 |
|---|---|---|---|
| 核心 | `v<x.y.z>`，如 `v1.0.0` | `docker-image.yml` | GHCR 多架构镜像 `:x.y.z` + `:latest` |
| 桌面壳 | `desktop-v<x.y.z>`，如 `desktop-v1.0.0` | `desktop-build.yml` | GitHub Release + DMG / MSI / EXE |
| 鸿蒙壳 | 不打 git tag | — | DevEco 打包，本地安装 / 应用市场 |

> 两个 workflow 的 tag 触发已分离：打核心 `v*` 不会连带触发桌面打包，反之亦然。任一 workflow 仍可用手动触发（workflow_dispatch）随时自测。

## 日常流程

**发核心版本**
```bash
# 1. 改 package.json 的 version + 更新 CHANGELOG.md
# 2. 打 tag 并推送：
git tag v1.0.1 && git push origin v1.0.1
# → 自动构建并发布镜像；NAS 上 docker compose pull && up -d 即更新
```

**发桌面壳版本**
```bash
# 1. 改 tauri.conf.json + Cargo.toml 的 version（记得同步 Cargo.lock）
git tag desktop-v1.0.1 && git push origin desktop-v1.0.1
# → 自动构建 DMG / MSI / EXE 并附到 GitHub Release
```

**发鸿蒙壳版本**：在 DevEco 里改 `app.json5` 的 `versionName` / `versionCode`，打包签名后分发。

## 改 bug 发 patch

实测发现 bug → 修 → 只把**受影响那部分**的版本尾数 +1（如核心 `1.0.0 → 1.0.1`）→ 更新 CHANGELOG → 打对应 tag。其他部分版本不动。

## 鸿蒙签名密钥（不入库）

`SendToMyself/build-profile.json5` 的 `signingConfigs` 含本地证书路径与密钥，**绝不入库**：
- 仓库内该文件的 `signingConfigs` 保持为空 `[]`。
- 本地 DevEco 打包时会自动写入真实签名信息。用下面命令让 Git 永久忽略这份本地改动，避免误提交密钥：
  ```bash
  git update-index --skip-worktree SendToMyself/build-profile.json5
  ```
- 换机器 / 重新 clone 后需再执行一次该命令。
