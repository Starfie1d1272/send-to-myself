# 部署指南

## 选择部署方式

| 方式 | 适合 | 需要 |
|------|------|------|
| **镜像部署** | NAS 可视化（群晖 / QNAP / Portainer 等），无需终端 | Docker，能打开网页复制粘贴即可 |
| **源码部署** | 有终端习惯、想自己改代码再部署 | Node 22+、pnpm、git |

---

## 方式一：镜像部署（推荐）

仓库提供预构建的多架构镜像（`linux/amd64` + `linux/arm64`），覆盖绝大多数设备和家用 NAS。

### 纯 Docker（有终端）

复制 [`deploy/docker-compose.yml`](../deploy/docker-compose.yml) 到你的服务器，把 `AUTH_PASSWORD` 换成强口令，然后：

```bash
docker compose up -d
```

### NAS 可视化部署

**群晖 Container Manager / QNAP Container Station / Portainer** 等：新建 Stack / Compose / 项目，把下面内容整段粘贴（改一下 `AUTH_PASSWORD`）：

```yaml
services:
  app:
    image: ghcr.io/starfie1d1272/send-to-myself:latest
    container_name: sendtomyself
    restart: unless-stopped
    environment:
      AUTH_PASSWORD: "改成你自己的强口令"
      SECURE_COOKIE: "true"
      MAX_UPLOAD_BYTES: "52428800"
    ports:
      - "8787:8787"
    volumes:
      - ./data:/data
```

部署后访问 `http://你的NAS_IP:8787`。如果想用域名 + HTTPS，继续看下方的反向代理段落。

> 镜像也可从[这里](https://github.com/Starfie1d1272/send-to-myself)源码自行构建：`docker compose up -d --build`（仓库根目录）。

---

## 方式二：源码部署

```bash
git clone https://github.com/Starfie1d1272/send-to-myself.git
cd send-to-myself
cp .env.example .env
# 编辑 .env，设 AUTH_PASSWORD
docker compose up -d --build
```

---

## 反向代理与 HTTPS

通过域名 + HTTPS 访问时，需要在前端接一个反向代理终止 TLS。

### 方案 A：Caddy（自动申请证书，推荐）

仓库已有 Caddy 模板。把 [`deploy/Caddyfile`](../deploy/Caddyfile) 里的域名改成你自己的，然后用一体化 compose 启动：

```bash
docker compose -f deploy/docker-compose.caddy.yml up -d
```

Caddy 会**自动**为你的域名申请并续期 Let's Encrypt 证书，全程无需人工干预。SSE 实时推送默认正常，无需额外配置。

### 方案 B：Nginx

适合已有 Nginx 或 NAS 自带反代（如群晖「反向代理服务器」）。关键配置：

```nginx
server {
    listen 443 ssl;
    server_name 你的域名;

    ssl_certificate     /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    client_max_body_size 60m;  # 与 MAX_UPLOAD_BYTES 对齐

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # SSE 实时同步：必须关缓冲，否则推送会被卡住
    location /api/realtime {
        proxy_pass http://127.0.0.1:8787;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
```

> ⚠️ Nginx 反代**务必保留 `/api/realtime` 那段**（`proxy_buffering off`），否则「这台发另一台立即出现」会失效。Caddy 无需额外处理。

如果 NAS 自带的反代面板没有「关闭缓冲」选项，建议改用上述 Caddy 模板，或者接受 SSE 推送延迟几秒。

---

## 验证

- 浏览器打开 `https://你的域名`，用设好的口令登录；
- 换另一台设备登录同一地址，这边发送、那边应**立即**出现（SSE 实时推送正常）；
- 上传一张图片、发一条链接，确认预览和附件正常。

---

## 配置参考

全部环境变量见 [`.env.example`](../.env.example)。常用：

| 变量 | 默认 | 说明 |
|---|---|---|
| `AUTH_PASSWORD` | 必填 | 登录口令；留空=认证关闭，**公网生产禁止留空** |
| `SECURE_COOKIE` | `true` | 经 HTTPS 反代时保持 true；纯内网 http 直连时改为 false |
| `MAX_UPLOAD_BYTES` | `52428800`（50 MB） | 单文件大小上限；改大需同步反代的 body 限制 |
| `TRASH_RETENTION_DAYS` | `30` | 回收站保留天数 |
| `SESSION_TTL_DAYS` | `30` | 登录会话有效期 |

## 备份

数据都在 `./data` 目录。SQLite 文件 + 附件全部落此卷，备份时整个拷走即可。

## 客户端连接

原生壳（桌面 / 鸿蒙）填的「服务器地址」即这里的 `https://你的域名`。—— [桌面壳说明](HARMONY_SHELL.md)
