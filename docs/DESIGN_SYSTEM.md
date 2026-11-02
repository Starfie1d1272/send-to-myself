# 暖纸界面维护说明

“发给自己”是主名称，SendToMyself 为次级名称；主页使用“NAS 上的跨设备收件箱”。保留单列、时间分组和既有图标。Web 首页最大宽度 680px，桌面连接卡片最大宽度 480px；窄屏留 16px 边距，弹窗高度按动态视口限制并允许滚动。

Web 的 `global.css`、桌面的 `styles.css` 和鸿蒙的 `common/Theme.ets` 分别保存本地语义值：paper `#f2ece1`、paper-2 `#ece3d4`、card `#fbf7ef`、card-hi `#fffdf8`、ink `#241d16`、ink-soft `#5b5044`、ink-faint `#938573`、line `#e3d9c7`、line-strong `#d3c4ab`、accent `#bc4b2a`、accent-deep `#9a3a1f`、error `#a8331e`、success `#5f7a4f`。必要状态使用文字，不能仅依赖颜色。间距采用 4/8/12/16/24/32，卡片圆角 14，输入和主要按钮 10，标签 6；输入和正文 16px，说明 14px，元信息 13px。控件触屏目标至少 44px。系统选择器与分享面板保持系统外观。

Web 的 `.button` 及其 `--primary`、`--secondary`、`--quiet`、`--danger` 变体、`.field` 和 `.inline-status` 用于新控件。`Dialog` 包装原生模态及焦点恢复；`InlineStatus` 为普通消息提供 status、错误提供 alert。焦点轮廓使用 accent，减少动态效果时取消非必要动画。固定浅色，不新增主题切换。

覆盖页面包括登录、编辑与发送、筛选与时间线、附件预览、设备连接、令牌和服务器信息；桌面首连与设置；鸿蒙启动、登录、附件确认、传输和分享结果。状态沿用各自业务所有者：待发送表示本机保留，已保存/已发送必须有相应确认；失败留在相关操作旁并提供既有重试。永久删除和移除本机未送达副本使用危险样式和既有确认。
