# SendToMyself Raycast 扩展

Mac 和 Windows 共用服务器上的记录，均为主动发送。无需新增全局快捷键，可以直接用 Raycast 搜索命令或为其设置 alias。

## 本地安装

1. 下载仓库 CI 的 `sendtomyself-raycast` 构件，解压里面的 ZIP，保留整个扩展目录。也可使用本仓库的 `apps/raycast` 目录。
2. 在 Raycast 搜索 **Import Extension**，选择含 `package.json` 的扩展目录；按 Raycast 提示完成依赖安装。如果提示开发环境缺失，按其开发工具指引安装 Node.js / npm。此扩展目前为本地安装，尚未上架商店。
3. 打开已更新的 SendToMyself 桌面窗口，用密码登录，在 **设备接入** 中创建 `Raycast Mac`（Windows 单独创建）。复制一次性令牌。
4. 在 Raycast 扩展设置填写服务器地址和 **设备令牌**。令牌是 password 类型偏好；不保存登录密码，不把令牌放进 URL。需要停用时在“设备接入”吊销。

## 三个入口

- **发送剪贴板**：发送文字、链接或一个文件路径。失败后保持内容不变再次运行即可重试；已在服务器提交但回复丢失时不会重复创建。可用 Raycast alias，例如 `stm`。
- **随手记录**：输入文字、选择图片/文件，一次发送。失败保留草稿和文件路径，重开也可继续；文件本身仍在原位置，不会被复制到草稿存储。
- **最近记录**：自动读取最新记录，输入关键词搜索，向下翻页；复制文字或直接粘贴到当前应用，附件先鉴权下载再复制文件。需要主动刷新时用“刷新记录”。敏感内容在此入口遮罩，需要到主窗口查看。

## 边界与验收

- Raycast 官方 Clipboard API 读取文字、HTML、文件路径，没有通用截图位图读取接口。只有位图的截图请先保存，再用“随手记录”选择图片；也可在桌面窗口直接粘贴发送。
- Raycast 的“复制文件”写入本地文件引用，适用于文件管理器等支持文件粘贴的目标；它不承诺所有聊天/图像应用都把图片文件当位图接收。桌面窗口的“复制图片”使用原生位图剪贴板，适合聊天/图像应用。
- 文本通过同一 API 跨端；图片、文件通过附件原始字节跨端。其他平台的原生图片剪贴板还需各自适配及验收，不能由共享 API 自动保证。
- 无后台监听、无自动剪贴板同步、无自动离线补发。失败需要主动重试；超过七天的未确认发送视为新发送。
- 一次最多 50 MB 文件，服务端可以设置更低限制。动图复制为位图时是首帧，原文件发送/下载保留动图。
- 草稿文字/文件路径、未确认请求指纹在本机 Raycast LocalStorage；获取的附件保存在扩展支持目录，仅本用户访问，后续复制时清理超过七天的缓存。令牌吊销阻止后续网络访问，不会删除已经下载的本地文件。
- 必须在实际 Mac / Windows Raycast 上验收命令显示、文件路径读取、向目标应用粘贴；CI 构建及 API 测试不能替代这些交互验收。

开发：`npm install`，`npm run build`。仓库开发可在根目录 `pnpm install`，`pnpm --filter send-to-myself-raycast build`。

资料：[Raycast Clipboard](https://developers.raycast.com/api-reference/clipboard)、[Manifest / platforms](https://developers.raycast.com/information/manifest)、[本地导入](https://developers.raycast.com/basics/getting-started)、[Preferences](https://developers.raycast.com/api-reference/preferences)。
