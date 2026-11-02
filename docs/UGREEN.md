# 绿联 NAS 安装与验证

此目录是 UGOS Pro Docker UPK **源码模板**，尚未发布 UPK，也没有真机验收结果。它复用通用 NAS 的单个核心镜像和 `/data`，不创建第二套后端。目标仅为 nasync；`pc` / `app` 是应用中心入口声明，不代表新增 Android/iOS 客户端。应用自身口令登录，不接 UGOS 单点登录。

## 打包（维护者）

在 Linux 准备 Docker、Python 3、GitHub CLI（可读取公开 release）和官方 [ugcli](https://developer.ugnas.com/doc/tools/ugcli.html)，不需要登录绿联。示例（版本须先是正式发布且存在对应镜像）：

```sh
scripts/package-ugreen.sh --version 1.0.2 --build 1 --arch all --output ./ugreen-output
```

版本必须是仓库的非草稿、非预发布 `vX.Y.Z` release；镜像固定为 GHCR 同数字 tag。脚本先固定多架构 manifest，再逐架构将临时配置限定为该架构并拉取对应 digest，检查架构与 OCI revision 是否匹配正式 release 提交，并检查导出 tar 的单 tag、配置 ID 和架构，再调用 `ugcli check` 和 `ugcli pack`。缺少 OCI revision 的旧镜像不能生成可追溯包。`manifest.json` 和 `SHA256SUMS` 与 UPK 一起输出；镜像/UPK 均不提交源码仓库。相同核心版本的上架构建号须递增。当前核心 1.1.0 是候选，不能作为已发布版本打包。脚本不发布、上传或连接 NAS。若某架构镜像不存在或检查失败则整体失败，空输出目录可重试。

官方依据：[Docker 打包](https://developer.ugnas.com/doc/backend/quick-start/develop-docker-app.html)、[project.yaml](https://developer.ugnas.com/doc/tools/project-yaml.html)、[端口与代理](https://developer.ugnas.com/doc/backend/application/app-port.html)、[打开方式](https://developer.ugnas.com/doc/backend/application/open-type.html)、[开发准备](https://developer.ugnas.com/doc/backend/quick-start/prepare.html)、[测试](https://developer.ugnas.com/doc/backend/quick-start/testing.html)、[发布](https://developer.ugnas.com/doc/backend/quick-start/publish.html)。官方文档规定产物路径为 `build_dir/pkgs/upk/{arch}_{product_series}_{appid}_{version}.upk`；脚本按此查找，但尚未使用 ugcli 实际校验模板、打包或确认输出。保留 Docker 默认代理配置，未限制为 `/api`；整站和 SSE 是否通过实际 UGOS 入口仍待验证。

## 新安装

以下是包可用后的步骤，当前没有可供普通用户安装的 UPK。手动测试须先按官方流程取得测试设备开发者授权；不应公开提交序列号、MAC 或管理员身份。

1. 安装符合要求的 Docker 套件（最低 1.7.0.0000），UGOS Pro 最低 1.13.0.0000。准备一个独立、已存在的空数据目录，确认容器可读写；数据库和附件都会存放于此。请备份数据，不要选择安装缓存目录。
2. 从应用中心安装已上架版本，或在已授权测试设备的应用中心手动安装与 CPU 架构对应的 nasync UPK。填写数据存储目录和 12–128 位登录口令；保存口令，其他设备使用相同口令。
3. 打开图标并登录，刷新确认会话。第二台设备使用实际可达地址登录，发送文字、图片和 PDF，在另一端打开或下载原件。直接局域网入口为 `http://NAS_IP:18787`。端口被占用时应先解决冲突，不能私自更换端口造成图标指错；路径或权限错误时检查日志，不要改挂临时空目录。

局域网 HTTP 不加密；远程访问需要实际可达的 HTTPS 路径。模板的 `SECURE_COOKIE=false` 为初始 HTTP 设置；自建 HTTPS 配置参见[部署指南](DEPLOY.md)。UGOS 代理网页入口的 Cookie、SSE 和文件传输尚待实测；UGREENlink 登录和重定向不保证可供自有原生客户端使用。

## 升级、备份和恢复

先按[备份与恢复](DEPLOY.md#备份与恢复)停服备份完整数据目录并验证备份。升级使用同一 app_id、原数据目录和递增的版本/构建号；检查 `/api/info` 版本、原消息及附件，再做一次双端收发。不需要额外数据库容器或复制 Web 文件。恢复时先停用写入实例，按部署指南在隔离目录恢复同版本备份并核对；旧版本不能读取新 schema 时，恢复升级前的完整备份，不承诺直接换旧镜像即可降级。

## 从通用 Compose 迁移与回退

1. 记录原完整数据路径、镜像版本和访问地址，停服备份并保留原 Compose 配置。
2. 停用原项目及 NAS 中配置的自动启动、定时拉起任务，确认没有其他实例写入该目录。
3. 安装 UPK 时选择原数据目录、使用原口令，不要以新空目录覆盖旧目录。核对旧记录和附件后再更改客户端入口。
4. 回退前先停用 UPK 及其自动拉起，再恢复原项目；任何时刻只能有一个 app 写同一数据目录。若 schema 不兼容，恢复升级前备份。

卸载是否保留外部目录尚未在真机确认；本项目不包含删除该目录的卸载脚本。用户负责备份和必要时手动清理外部目录，在确认前勿假设卸载会保留或删除数据。

## 隐私说明

正文、数据库和附件保存在用户选择的 NAS 数据目录；本项目没有中央内容服务。链接预览会访问用户提供的目标站点。当前 Web 页面还引用 Google Fonts（`fonts.googleapis.com` 和 `fonts.gstatic.com`）；加载字体会向这些服务发起请求，网络不可用时使用回退字体。远程入口由用户选择的网络及 NAS 服务提供，其处理方式由对应服务决定。

## 验收记录

当前环境无 ugcli、授权设备或真实 NAS；未生成 UPK，所有构建、安装、入口与卸载行为均未验证。记录时填写机型、CPU、UGOS/Docker 版本、UPK 完整版本、镜像 digest、手机/桌面版本；不要提交设备序列号、MAC、口令或地址。

| 架构 | 构建 | 安装 | 主流程 | 证据 |
|---|---|---|---|---|
| amd64 | 未执行 | 未执行 | 未执行 | 缺 ugcli 和设备 |
| arm64 | 未执行 | 未执行 | 未执行 | 缺 ugcli 和设备 |

| 路径/操作 | 待记录结果 |
|---|---|
| 局域网图标打开、登录、刷新、重启 | 根页面、assets、API、会话：未执行 |
| 直接局域网双端图文和 PDF | SSE、原件保存读取：未执行 |
| UGREENlink 网页 | 页面、Cookie、SSE、上传下载：未执行 |
| 手机移动网络网页（关闭 Wi-Fi） | 登录与收发：未执行 |
| 鸿蒙/桌面客户端外网地址 | 未执行；若需要额外 NAS 登录或不支持重定向，记录该路径不支持 |
| 升级 | 旧记录附件和新发送：未执行 |
| 隔离目录恢复同版本备份 | 普通内容完整，已开始永久删除的内容继续清理：未执行 |
| 端口占用及路径权限错误 | 明确失败、无假空收件箱：未执行 |
| 卸载与重装 | 数据目录行为：未执行 |
