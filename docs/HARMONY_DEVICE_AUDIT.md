# Pura 70 Pro 适配调查

调查日期：2026-10-12。代码基线：`main` 的 `53d0645`，修复提交 `2dbf787` 包含本次 ArkTS 编译、凭据保存和离线启动修复。

## 已取得的证据

| 项目 | 结果 |
|---|---|
| 命令行连接 | 使用本机 HoKit 自带 HDC，复用现有无线连接，设备状态为 Connected |
| 真机身份 | `const.product.name` = HUAWEI Pura 70 Pro；型号 HBN-AL00 |
| 系统 | 7.0.0.109(SP8C00E105R5P2)，设备 API 26 |
| 已安装应用 | `com.sendtomyself.harmony`，1.0.0 / 1000000，debug 包 |
| 旧包启动 | EntryAbility 启动成功，界面树显示登录页和地址/口令输入框；无有效登录证据 |
| 最新代码初次编译 | ShareFiles.ets 两处 `throw error` 触发 `arkts-limited-throw` |
| 编译修复 | 将捕获值显式断言为 Error，保留原始异常与文件清理路径 |
| 修复后 SDK 构建 | DevEco 自带 SDK，compileSdkVersion 26.0.0.23，assembleHap / SignHap 成功 |
| 最新包安装 | HDC replace 安装返回 install bundle successfully；设备 updateTime 更新 |
| 最新包启动 | 首次因锁屏返回 10106102；解锁后启动成功 |
| 原生登录 | 本机隔离后端返回 login 200 / devices 201；修复后日志确认 Device token saved successfully 和 Cookie injected |
| 冷启动 | force-stop 后启动，日志确认 Cookie found，Web 加载进度达到 100，网页会话保持 |
| WebView 发送 | 手机发送测试文字，后端读回 1 条对应记录 |
| 浏览器系统分享 | 系统面板显示“发给自己”；ShareExtAbility 报告 success=true，后端读回分享链接 |
| SSE 与图片显示 | Mac 上传测试 PNG 后，手机当前时间线出现附件，缩略图请求返回 200 |
| 离线队列 | 停止测试后端，浏览器分享入队；force-stop、冷启动及 replace 安装后，真机显示“待发送 1 条” |
| 恢复补发 | 恢复测试后端并点击重试，总记录数从 4 到 5；再次冷启动未增加重复记录 |
| 文件向外分享 | 点击测试 TXT 的分享按钮，真机显示“此设备不支持直接分享文件，请下载后发送。” |
| 文件下载 | 点击下载后，后端 raw?download=1 返回 200；未观察到保存对话框，用户可访问的保存位置仍未验证 |
| 回归与构建 | Web 19 项测试、API 13 项测试通过；Web/API 类型检查及 Web 构建通过；最终 ArkTS 签名构建成功 |

构建使用当前命令的 `DEVECO_SDK_HOME` / `JAVA_HOME` 指向 DevEco 自带目录，未修改用户级环境。
签名使用已有本地配置；证书、密码和设备令牌不写入本报告。壳版本号未增加，设备上的 1.0.0 本身不足以识别代码版本。

## NAS 连接结果

- 使用本机已保存的 `nas` SSH 配置访问；SSH 在交换密钥前返回 Connection closed，尚未登录，尚未读取容器或后端版本。
- 手机登录页保存的后端地址为 NAS 局域网 HTTP 地址。Mac HTTP 探测返回 Empty reply from server，未获得应用响应。
- Mac 到该地址的路由经过代理隧道；手机对该地址的单次 ping 未收到响应。这些结果不足以判定 NAS 服务已停机。
- 需要确认当前可达地址，再读取后端镜像 digest / 版本、容器运行状态、必要的脱敏错误日志。保留部署数据与配置。
- 用户随后给出 EasyTier 地址，并要求暂缓 NAS 排查。本轮未登录 NAS，也未修改部署。

## 本机替代测试路径

本轮在 Mac 启动当前源码的完整 API，使用系统临时目录中的独立 SQLite 与附件目录，启用临时测试口令，托管当前 Web 构建。
HDC `rport tcp:18787 tcp:18787` 将手机的 localhost:18787 转到 Mac 的测试后端，可通过 HoKit 已建立的无线连接使用。
该路径不依赖手机加入 NAS 的网络，覆盖原生登录、WebView、分享扩展和队列；不验证 NAS 的卷权限、反代、TLS、镜像身份或长期运行。
HTTP 测试需关闭 SECURE_COOKIE；生产按 DEPLOY.md 配置 HTTPS 与安全 Cookie。
测试结束后撤销隔离后端签发的设备令牌，恢复手机原先保存的 NAS 地址；停止本轮测试进程、移除 HDC 端口转发和临时数据。后续使用该路径需重新启动测试服务并登录。

## 本轮修复

- ArkTS 禁止抛出任意类型捕获值：两处重抛显式断言为 Error。
- AssetStore 的 IS_PERSISTENT 用于卸载后保留资产，需要 STORE_PERSISTENT_DATA 权限，当前清单未声明；移除该标记后，普通加密资产保存成功且冷启动可读。
- 登录异常由页面捕获，finally 恢复 busy 状态，显示可重试提示。
- 认证不可达或非 200 返回 unknown，已配置客户端尝试加载缓存网页；只有明确认证无效才回登录页。断网测试确认队列提示可见，网页服务仍可能显示“无法连接服务”。
- 鸿蒙模拟测试使用 Node 文件常量和文件描述符读写，修复 macOS 上的 Linux O_CREAT 数值与 /proc/self/fd 路径假设；增加资产保存和离线认证回归。

## 剩余缺口

| 优先级 | 缺口 | 依据与验收方式 |
|---|---|---|
| 阻塞 | NAS 可达性及后端版本未知 | 当前网络证据如上；连通后核对后端是否包含 main 的队列/附件契约 |
| 高 | NAS 登录及完整 WebView 交互待验收 | 本机登录/冷启动/文字发送已通过；NAS、输入法组合键、返回键、附件选择仍需实测 |
| 高 | 相册、文件和多文件分享未真机验证 | 浏览器链接已通过；仍需验证分享 URI 授权、文件名、MIME 和字节 |
| 高 | 离线附件与自动补发未真机验证 | 本轮模拟后端不可达，未切飞行模式；文本持久化和手动重试已通过，网络恢复回调、并发真机操作及附件完整性仍待验收 |
| 高 | 待发送内容缺少逐条查看/删除 | QueueService 仅提供汇总和补发，MainPage 只有数量/错误及重试；413 或服务器切换时用户不能逐条处理 |
| 高 | 文件向外分享与下载保存入口 | 真机向外分享明确不支持；下载 HTTP 成功，尚未证实文件可取用，需要原生桥/下载委托及保存位置验证 |
| 中 | HTTP 场景图片复制能力有限 | copyImage 的浏览器路径要求 secure context；鸿蒙壳无图片剪贴板桥，需用当前 NAS 地址验证实际提示 |
| 中 | 深色与键盘布局未验收 | 主页面与分享页使用固定颜色；输入框弹键盘、系统深色、大字体、安全区域需独立实测 |

ArkWeb 提供默认文件选择行为，缺少 onShowFileSelector 回调本身不能证明上传失败。下载路径与生命周期应按[华为 ArkWeb 下载文档](https://developer.huawei.com/consumer/en/doc/harmonyos-guides-V14/web-download-V14)核对，并以真机结果判定。

## 收尾条件

`HARMONY_SHELL.md` §10 和 `RELIABILITY.md` 的完整真机清单仍保持待验收；本轮已通过项及测试环境如上。完整适配验收仍有剩余项。
下轮记录每项真机操作、客户端代码身份、后端镜像身份、另一端可见结果及失败原因，确认后再勾选对应验收项。
