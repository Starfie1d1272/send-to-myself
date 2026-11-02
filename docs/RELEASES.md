# 当前交付与验证范围

以下公开状态核对于 2026-11-02。主线实现、CI 构件、公开 Release 和设备验证是不同状态；未列出未经验证的兼容组合。升级与回退统一按[部署、备份与恢复](DEPLOY.md)执行。

| 组件 / 通道 | 真实入口 | 来源与配套范围 | 验证与限制 |
|---|---|---|---|
| 核心 1.1.0-rc.1 / 预发布 | [Release、NAS ZIP 与校验文件](https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.1.0-rc.1) | 源码 `44fe3c15c9d40905e06f4653e5e0661b42b8c6aa`；镜像索引 digest `sha256:d0947b81ddb6188d1b7512b00fec1303700b1305c762eb14c3dafa2504cf267c`，含 linux/amd64 与 linux/arm64；ZIP SHA256 `87ef3caf7fcad9fe6e5c43c1e8875862413e4ed7be5270fabd090a1e47776470` | [发行构建](https://github.com/Starfie1d1272/send-to-myself/actions/runs/41456249505)成功；下载解压、包内校验与 Compose 镜像一致性通过。真实 NAS、arm64 启动和 HTTPS/PWA 升级未验 |
| 桌面 1.1.0-rc.1 / 预发布 | [Release 与资产](https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.1.0-rc.1) | 源码 `44fe3c15c9d40905e06f4653e5e0661b42b8c6aa`，与核心 1.1.0-rc.1 配套；Apple Silicon DMG 8,692,246 字节、Windows x64 EXE 4,344,089 字节 / MSI 6,287,360 字节，SHA256 见 Release | [发行构建](https://github.com/Starfie1d1272/send-to-myself/actions/runs/41456249614)成功，三份资产已下载并计算摘要；尚未挂载 DMG、核对签名/公证或在设备安装，未提供 Intel Mac 包 |
| 核心 1.0.2 / 正式 | [Release](https://github.com/Starfie1d1272/send-to-myself/releases/tag/v1.0.2)、[GHCR](https://github.com/Starfie1d1272/send-to-myself/pkgs/container/send-to-myself) | `:1.0.2`；tag 源码 `b604a8c39efa4133c194ed800fa47f9a91f379e2`，未核实镜像构建 SHA；该 Release 无 NAS 运维 ZIP；本表未取得镜像 digest | 历史恢复证据见 [RELIABILITY](RELIABILITY.md)；不代表当前主线的完整旅程已验收 |
| 桌面 1.0.0 / 正式 | [Release 与资产](https://github.com/Starfie1d1272/send-to-myself/releases/tag/desktop-v1.0.0) | Windows x64 EXE/MSI、macOS Apple Silicon DMG；tag 源码 `113c14069ffa693d76f83ee2ef0dc80ffddaf32f`，未核实构建 SHA；未建立本轮配套核心兼容范围 | 无 Intel Mac 包；新设置及原生复制属于后续源码，不应归属于此包；实际应用交互仍需真机验证 |
| 鸿蒙 1.1.1-rc.1 / 预览 | [Release 与资产](https://github.com/Starfie1d1272/send-to-myself/releases/tag/harmony-v1.1.1-rc.1) | 发布页指向源码 `c5c3f6d6258578696fb52a2e301ad979f17da2b5`；含未签名 HAP、配套 web-dist 和校验和；自行签名，按发布说明使用配套页面 | [设备审计](HARMONY_DEVICE_AUDIT.md)的旧版实测不覆盖新后台传输；不是普通用户下载即用的安装包 |
| 桌面 1.1.0 / 仅构建候选 | [Windows x64 Actions 构件](https://github.com/Starfie1d1272/send-to-myself/actions/runs/41393518762/artifacts/13118283929)、[macOS Apple Silicon Actions 构件](https://github.com/Starfie1d1272/send-to-myself/actions/runs/41393518762/artifacts/13118243913)；[构建记录](https://github.com/Starfie1d1272/send-to-myself/actions/runs/41393518762) | 两端构建 SHA `a1cb001957cf0fbc669f3d15af0f728f50b718bb`；构件名标注最低配套核心 1.1.0，尚未建立实际设备兼容范围；不是公开正式 Release | Windows x64 和 macOS arm64 构建及原生检查成功，均未安装验收；macOS 构件下载返回 403，包内文件未核实。Actions 构件可能过期或需要仓库权限 |
| 核心 1.1.0 / 本地隔离构建 | 本地 amd64 镜像，无公开下载 | 构建源码 `d82e7759a3a0ce06346db73353af8f42ee5946b3`，本地镜像 ID `sha256:0ad96b943f38a21530baa64d77be2d1cacc21b3261a6a5ac7ad84482144cd325`；这不是已推送镜像 digest | 本地启动与原生依赖检查通过；备份恢复演练在提交前的另一份本地镜像通过。构建上下文中 Dockerfile、核心 API/Web、shared、工作区配置和锁文件与合并源码 `a069b8598f0a01c28430662d316ce907eda21939` 相同，但镜像身份与构建 SHA 不同。arm64、真实 NAS 未验 |
| 当前主线 / 源码 | [仓库](../README.md) | 本轮核心 1.1.0-rc.1、桌面 1.1.0、鸿蒙 1.2.0 为源码版本；不代表已正式发布。预发布与历史本地构建记录见上 | 鸿蒙 SDK 构建及实机、真实 NAS、arm64 镜像启动、完整设备旅程和 HTTPS/PWA 旧页与草稿升级行为未验证 |

历史设备结果按版本与环境记录在 [HARMONY_DEVICE_AUDIT.md](HARMONY_DEVICE_AUDIT.md)，不能外推到新构件。核心预发布运维 ZIP 已核验解压路径、校验和及镜像身份；这不代表真实 NAS 安装已验收。

## RC 配套与后续事项

核心与桌面候选已发布，实际构件和验证范围见上；其余构件状态以对应记录为准。不要沿用旧 Actions 构件冒充新构建。

| 组件 | 候选和构件 | 状态与后续核对 |
|---|---|---|
| 核心 | `v1.1.0-rc.1`，镜像 `:1.1.0-rc.1`（amd64、arm64）、`sendtomyself-nas-1.1.0-rc.1.zip` 及 ZIP SHA256 | 根/API/Web 版本需与完整 tag 一致，添加对应 `core-1.1.0-rc.1` 变更段；workflow 推送固定 tag、构建实际 digest、生成运维包并标记 prerelease，不更新 `latest`。核对两架构镜像、解压文件及脚本，登记 SHA/digest |
| 桌面 | `desktop-v1.1.0-rc.1`，Apple Silicon DMG、Windows x64 EXE/MSI | Tauri 内部版本使用 `1.1.0`，workflow 将 tag 去后缀与内部版本比较；需有 `desktop-1.1.0-rc.1` 变更段，发布标记 prerelease。记录构建 SHA、最低核心要求和各资产校验；未验 Intel Mac |
| 鸿蒙 | 另行准备 `harmony-v1.2.0-rc.1` 未签名 HAP、配套 web-dist 与 SHA256 | 当前主线 `versionName` 1.2.0、`versionCode` 1002000；覆盖安装前须相对实际已安装包递增 code。手动 SDK 构建与签名流程、对应 SHA 和核心版本需单独登记；不得公开设备签名材料，不能以 Mac 验收代替真机 |
| Raycast | 对最终提交的 CI `sendtomyself-raycast` ZIP 本地导入 | 扩展 package 版本为 1.0.0，当前没有独立公开 Release；CI 构件下载返回 403。可从核心 RC tag 的源码取得 `apps/raycast` 本地导入，需安装依赖；实际 Mac 授权和粘贴需验收 |

已发布 tag 不得覆盖。核心 tag 要求完整预发布版本写入三个 package 版本，而桌面内部版本不含 RC 后缀；两者都需对应组件专属 changelog 段，现有 1.1.0 段不能直接满足 RC 提取。鸿蒙采用手动流程。自动构建成功也不代表发布资产已核对或真机通过。

Mac 的具体测试顺序见 [部署指南 RC 路线](DEPLOY.md#rc-验收路线候选发布后执行)：候选 NAS 与 Apple Silicon 桌面配套、记录版本及结果，再导入同提交 Raycast 构件。未取得对应资产前不得将其写成可下载链接。

最终提交 [main CI](https://github.com/Starfie1d1272/send-to-myself/actions/runs/41455866590) 已生成 Raycast 构件，但下载返回 403，尚未核验包内内容；可使用核心 RC tag 的源码目录导入，或在有权限的环境取得该构件。鸿蒙 1.2.0 RC 的 SDK 构建及 HAP 尚未完成，不以旧版预览代替。
