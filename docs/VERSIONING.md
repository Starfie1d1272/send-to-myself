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

发布工作流调整由本工作包的构建范围完成。目标规则是只有明确的正式核心版本更新 `latest`；预发布和手动候选不更新它。**当前主线旧版 Docker workflow 仍给手动构建添加 `latest`**，在相应修改合入并验证前不要假定目标规则已生效。手动候选及 RC 的具体 tag 和实际工作流行为以合入后的配置和运行结果为准。

组件发布说明应只描述对应组件，历史记录不改写。升级前按[部署指南](DEPLOY.md#备份与恢复)备份完整数据与配置；回退采用升级前备份和对应旧版本，旧核心未必能读取新迁移后的数据。版本号和构建 SHA 不能代替实际设备验证。
