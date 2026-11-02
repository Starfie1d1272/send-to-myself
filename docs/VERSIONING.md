# 版本管理

核心（根、`apps/api`、`apps/web` 和镜像）、桌面和鸿蒙独立版本，遵循语义化版本。当前公开版本与配套验证范围见 [RELEASES](RELEASES.md)；源码版本、构建产物和公开发布不能互相替代。

| 组件 | 版本来源 | 发布节奏与入口 |
|---|---|---|
| 核心 | 根、API、Web 的 `package.json`；`/api/info` 读取 API 版本 | `v<x.y.z>` 核心 tag 对应 GHCR 固定版本镜像，API 和 Web 随同一镜像交付 |
| 桌面 | `apps/desktop/src-tauri/tauri.conf.json` 和 `Cargo.toml` | `desktop-v<x.y.z>`；当前构建 Windows x64 EXE/MSI 和 macOS arm64 DMG |
| 鸿蒙 | `SendToMyself/AppScope/app.json5` 的 `versionName` / `versionCode` | `harmony-v<x.y.z>`，预发布追加 `-rc.N`；公开未签名 HAP 需自行签名 |

## 发布准备

核心、桌面、鸿蒙分别记录实际 tag、源码 SHA、平台、对应核心版本和验证结果。设备覆盖安装时递增鸿蒙 `versionCode`，不公开设备绑定的签名包、证书或密码。已有正式 tag 不覆盖或改写。主线合并不自动部署用户 NAS，也不等于正式发布。

当前工作包目标为核心 1.1.0、桌面 1.1.0、鸿蒙 1.2.0，尚未因此成为公开下载。候选构件取得后记录实际来源和配套范围；正式发布后才更新推荐入口。核心镜像的固定 tag 和实际 digest、运维包中的 `VERSION.json` 与 Compose 镜像应一致；从实际生成包验证，而非凭计划宣称完成。

核心 workflow 仅由无预发布后缀的核心版本 tag 更新 `latest`；预发布版本使用完整固定 tag，手动构建使用 `sha-<短SHA>` 候选 tag。正式或预发布 tag 的镜像推送成功后，将由实际推送 digest 生成的运维 ZIP 及其 SHA256 附到对应 GitHub Release；手动候选不生成正式运维包。源码配置不代表已执行发布。

组件变更说明分别提取 `core-版本`、`desktop-版本`、`harmony-版本` 段落。鸿蒙保留现有手动构建及发布方式，可运行 `node scripts/extract-changelog.mjs harmony <版本>` 取得对应段落，并另行记录实际构建 SHA、平台及配套核心版本。

构建范围曾以提交 `d82e7759a3a0ce06346db73353af8f42ee5946b3` 本地构建 amd64 镜像并验证启动及备份恢复；使用合成文件的默认预算并发演练记录了两批成功、第三批限流与超限拒绝。这些结果针对该提交的本地镜像，不代表后续源码、正式产物或真实 NAS 已通过验证。arm64 构建、实际镜像 digest 和设备验收仍需另行记录。

组件发布说明应只描述对应组件，历史记录不改写。升级前按[部署指南](DEPLOY.md#备份与恢复)备份完整数据与配置；回退采用升级前备份和对应旧版本，旧核心未必能读取新迁移后的数据。版本号和构建 SHA 不能代替实际设备验证。
