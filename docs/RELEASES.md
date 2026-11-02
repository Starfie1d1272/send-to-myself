# 当前交付与验证范围

以下公开状态核对于 2026-11-02。主线实现、CI 构件、公开 Release 和设备验证是不同状态；未列出未经验证的兼容组合。升级与回退统一按[部署、备份与恢复](DEPLOY.md)执行。

| 组件 / 通道 | 真实入口 | 来源与配套范围 | 验证与限制 |
|---|---|---|---|
| 核心 1.0.2 / 正式 | [Release](https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.0.2)、[GHCR](https://github.com/Starfie1d1272/send-to-myself/pkgs/container/send-to-myself) | `:1.0.2`；tag 源码 `b604a8c39efa4133c194ed800fa47f9a91f379e2`，未核实镜像构建 SHA；该 Release 无 NAS 运维 ZIP；本表未取得镜像 digest | 历史恢复证据见 [RELIABILITY](RELIABILITY.md)；不代表当前主线的完整旅程已验收 |
| 桌面 1.0.0 / 正式 | [Release 与资产](https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.0.0) | Windows x64 EXE/MSI、macOS Apple Silicon DMG；tag 源码 `113c14069ffa693d76f83ee2ef0dc80ffddaf32f`，未核实构建 SHA；未建立本轮配套核心兼容范围 | 无 Intel Mac 包；新设置及原生复制属于后续源码，不应归属于此包；实际应用交互仍需真机验证 |
| 鸿蒙 1.1.1-rc.1 / 预览 | [Release 与资产](https://github.com/Starfie1d1272/send-to-myself/releases/tag/harmony-v1.1.1-rc.1) | 发布页指向源码 `c5c3f6d6258578696fb52a2e301ad979f17da2b5`；含未签名 HAP、配套 web-dist 和校验和；自行签名，按发布说明使用配套页面 | [设备审计](HARMONY_DEVICE_AUDIT.md)的旧版实测不覆盖新后台传输；不是普通用户下载即用的安装包 |
| 桌面 1.1.0 / 仅构建候选 | [Windows x64 Actions 构件](https://github.com/Starfie1d1272/send-to-myself/actions/runs/41393518762/artifacts/13118283929)、[macOS Apple Silicon Actions 构件](https://github.com/Starfie1d1272/send-to-myself/actions/runs/41393518762/artifacts/13118243913)；[构建记录](https://github.com/Starfie1d1272/send-to-myself/actions/runs/41393518762) | 两端构建 SHA `a1cb001957cf0fbc669f3d15af0f728f50b718bb`；构件名标注最低配套核心 1.1.0，尚未建立实际设备兼容范围；不是公开正式 Release | Windows x64 和 macOS arm64 构建及原生检查成功，均未安装验收；macOS 构件下载返回 403，包内文件未核实。Actions 构件可能过期或需要仓库权限 |
| 核心 1.1.0 / 本地隔离构建 | 本地 amd64 镜像，无公开下载 | 构建源码 `d82e7759a3a0ce06346db73353af8f42ee5946b3`，本地镜像 ID `sha256:0ad96b943f38a21530baa64d77be2d1cacc21b3261a6a5ac7ad84482144cd325`；这不是已推送镜像 digest | 本地启动与原生依赖检查通过；备份恢复演练在提交前的另一份本地镜像通过。构建上下文中 Dockerfile、核心 API/Web、shared、工作区配置和锁文件与合并源码 `a069b8598f0a01c28430662d316ce907eda21939` 相同，但镜像身份与构建 SHA 不同。arm64、真实 NAS 未验 |
| 当前主线 / 源码 | [仓库](../README.md) | 本轮核心 1.1.0、桌面 1.1.0、鸿蒙 1.2.0 为源码版本；不代表已正式发布。候选及本地构建记录见上，真实发布 digest 尚未取得 | 鸿蒙 SDK 构建及实机、真实 NAS、arm64 镜像启动、完整设备旅程和 HTTPS/PWA 旧页与草稿升级行为未验证 |

历史设备结果按版本与环境记录在 [HARMONY_DEVICE_AUDIT.md](HARMONY_DEVICE_AUDIT.md)，不能外推到新构件。NAS 运维 ZIP 是本轮计划产物，尚未作为公开下载提供；生成后需在解压目录验证路径、脚本与镜像身份，再登记其来源、digest 和结果。
