# 当前交付与验证范围

以下公开状态核对于 2026-11-02。主线实现、CI 构件、公开 Release 和设备验证是不同状态；未列出未经验证的兼容组合。升级与回退统一按[部署、备份与恢复](DEPLOY.md)执行。

| 组件 / 通道 | 真实入口 | 来源与配套范围 | 验证与限制 |
|---|---|---|---|
| 核心 1.0.2 / 正式 | [Release](https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.0.2)、[GHCR](https://github.com/Starfie1d1272/send-to-myself/pkgs/container/send-to-myself) | `:1.0.2`；tag 源码 `b604a8c39efa4133c194ed800fa47f9a91f379e2`，未核实镜像构建 SHA；该 Release 无 NAS 运维 ZIP；本表未取得镜像 digest | 历史恢复证据见 [RELIABILITY](RELIABILITY.md)；不代表当前主线的完整旅程已验收 |
| 桌面 1.0.0 / 正式 | [Release 与资产](https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.0.0) | Windows x64 EXE/MSI、macOS Apple Silicon DMG；tag 源码 `113c14069ffa693d76f83ee2ef0dc80ffddaf32f`，未核实构建 SHA；未建立本轮配套核心兼容范围 | 无 Intel Mac 包；新设置及原生复制属于后续源码，不应归属于此包；实际应用交互仍需真机验证 |
| 鸿蒙 1.1.1-rc.1 / 预览 | [Release 与资产](https://github.com/Starfie1d1272/send-to-myself/releases/tag/harmony-v1.1.1-rc.1) | 发布页指向源码 `c5c3f6d6258578696fb52a2e301ad979f17da2b5`；含未签名 HAP、配套 web-dist 和校验和；自行签名，按发布说明使用配套页面 | [设备审计](HARMONY_DEVICE_AUDIT.md)的旧版实测不覆盖新后台传输；不是普通用户下载即用的安装包 |
| 当前主线 / 源码 | [仓库](../README.md) | 本轮目标核心 1.1.0、桌面 1.1.0、鸿蒙 1.2.0；不是已发布版本。本轮配套构件、SHA 和 digest 尚待构建登记 | 构建、两架构启动、完整设备旅程及 HTTPS/PWA 旧页与草稿升级行为均待实际验证 |

历史设备结果按版本与环境记录在 [HARMONY_DEVICE_AUDIT.md](HARMONY_DEVICE_AUDIT.md)，不能外推到新构件。NAS 运维 ZIP 是本轮计划产物，尚未作为公开下载提供；生成后需在解压目录验证路径、脚本与镜像身份，再登记其来源、digest 和结果。
