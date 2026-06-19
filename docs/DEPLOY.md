# 部署指南

把 SendToMyself 跑在你自己的服务器（NAS / VPS）上，通过域名 + HTTPS 访问。

## 你需要准备

- 一台能跑 **Docker** 的机器（NAS、云服务器都行）；
- 一个**域名**，DNS 解析到这台机器的公网 IP（如 `stm.example.com`）；
- 机器的 `80` / `443` 端口可被公网访问（家宽 NAS 需在路由器做端口转发）。

## 第一步：起服务

```bash
git clone https://github.com/Starfie1d1272/send-to-myself.git
cd send-to-myself
cp .env.example .env
# 编辑 .env，把 AUTH_PASSWORD 改成一个强口令（这是你唯一的登录口令）
docker compose up -d --build
```

服务现在跑在 `127.0.0.1:8787`，**只监听本机**——还不能从公网访问。这是故意的：让反向代理在前面终止 HTTPS。

## 第二步：反向代理（要不要自己操心？）

**简短回答：需要一个反代，但用 Caddy 几乎零负担——两行配置，证书全自动。**

为什么必须有反代：
- 应用本身不处理 HTTPS（证书申请/续期交给专业工具）；
- 登录用的 cookie 标了 `Secure`，**没有 HTTPS 就登不上**；
- 公网裸跑 HTTP 不安全。

Caddy 会**自动**为你的域名申请并续期 Let's Encrypt 证书。`Caddyfile` 只要一段：

```caddy
stm.example.com {
    reverse_proxy app:8787
}
```

SSE 实时推送、WebSocket 升级 Caddy 默认就支持，无需额外配置。

> ⚠️ **常见坑**：本仓库的 compose 把端口绑在宿主机 `127.0.0.1`。如果 Caddy 跑在**另一个容器**里，容器内的 `127.0.0.1` 指向的是它自己、连不到应用。所以要么让 Caddy 和应用**在同一个 compose 网络里、用服务名 `app:8787`**（推荐，下方做法），要么用宿主机直接安装的 Caddy 才能用 `127.0.0.1:8787`。

#### 推荐：把 Caddy 加进同一个 compose

在 `docker-compose.yml` 里追加一个 `caddy` 服务（与 `app` 同网络，故用 `app:8787`）：

```yaml
  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy-data:/data        # 证书持久化，别丢
      - ./caddy-config:/config
```

> 同 compose 内服务互通，应用的 `ports` 那行甚至可以删掉（不必再对宿主暴露 8787）。

```bash
docker compose up -d        # 起 app + caddy
```

访问 `https://stm.example.com` 即可，证书自动签发、自动续期。

### 方案 B：Nginx（已有 Nginx 时）

自己用 certbot 等签好证书后：

```nginx
server {
    listen 443 ssl;
    server_name stm.example.com;

    ssl_certificate     /etc/letsencrypt/live/stm.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/stm.example.com/privkey.pem;

    client_max_body_size 60m;          # 与 MAX_UPLOAD_BYTES 对齐（默认 50MB）

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # SSE 实时同步：关闭缓冲，否则推送会被卡住
    location /api/realtime {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
```

> 用 Nginx 时务必加 `/api/realtime` 那段（`proxy_buffering off`），否则「这台发那台立即出现」会失效。Caddy 无需操心这点。

## 第三步：验证

- 打开 `https://你的域名`，用 `AUTH_PASSWORD` 登录；
- 在另一台设备登录同一地址，一边发送、另一边应**立即**出现（验证 SSE）；
- 上传一张图片、存一个链接，确认预览正常。

## 配置项

全部环境变量见 [.env.example](../.env.example)。常用：

| 变量 | 默认 | 说明 |
|---|---|---|
| `AUTH_PASSWORD` | （必填） | 登录口令；留空=关闭认证，**切勿用于公网** |
| `SECURE_COOKIE` | `true` | 经 HTTPS 反代时保持 true |
| `MAX_UPLOAD_BYTES` | `52428800` | 单文件上限（50MB）；改大记得同步反代的 body 限制 |
| `TRASH_RETENTION_DAYS` | `30` | 回收站保留天数 |
| `SESSION_TTL_DAYS` | `30` | 登录会话有效期 |

## 备份

> 未恢复过的备份等于无备份。

数据（SQLite + 附件）都在 `./data` 卷里。备份/恢复脚本见仓库根 `scripts/`，详见 [README](../README.md#备份与恢复spec-13)。

## 原生客户端连接

桌面壳 / 鸿蒙壳填的「服务器地址」就是这里的 `https://你的域名`。原生壳的分享用长效设备令牌认证（网页登录后铸造），细节见 [HARMONY_SHELL.md](HARMONY_SHELL.md)。
