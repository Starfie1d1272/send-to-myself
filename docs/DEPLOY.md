# NAS 部署指南

## 适用条件

需要已有支持 Docker Compose 的 NAS 和可访问的镜像仓库。本服务是单用户、单收件箱。普通安装不需要克隆源码、编译或安装 Node。局域网 HTTP 不加密；远程访问应配置 HTTPS 和实际可达的网络路径。

## 1. 创建数据目录

在 NAS 文件管理器创建专用 data 文件夹，通过 Docker 的目录选择或映射界面记录其**真实宿主机绝对路径**。数据库和附件都存放在这个目录；不要使用相对路径，也不要假定每台 NAS 的路径相同。模板中的路径是必须替换的占位符。目录不存在时部署应失败，避免静默创建空收件箱。

## 2. 创建并启动项目

在 NAS Docker 管理界面新建 Compose 项目，建议新项目命名 `sendtomyself`。将[基础模板](../deploy/docker-compose.yml)粘贴到项目中：

1. 将 `AUTH_PASSWORD` 替换为自己的强口令；将 `source` 替换成刚记录的已有目录的绝对路径。只有这两项必须填写。
2. Compose 会插值 `$`，口令中的每个 `$` 写成 `$$`。例如配置 `pa$$word` 对应实际口令 `pa$word`。
3. 默认映射 `"8787:8787"`。端口冲突时只改左侧宿主端口（如 `"18787:8787"`），右侧保持 8787。
4. 启动项目。服务名为 `app`，镜像固定为 `ghcr.io/starfie1d1272/send-to-myself:1.0.2`，容器 `/data` 映射到上述目录。默认 `SECURE_COOKIE: "false"` 用于 HTTP，单文件上限 `52428800` 字节（50 MiB）。

## 3. 登录与第二台设备

登录失败限速按实际连接地址计算，不信任转发头；反向代理后的客户端共享代理地址的失败锁定。

在第一台设备访问 `http://NAS_IP:宿主端口`（默认 `http://NAS_IP:8787`），用设置的口令登录，刷新页面确认仍保持登录。换端口后浏览器和原生客户端都要使用新宿主端口。

在同一网络的第二台设备打开相同的可达地址并登录；发送一条文字、一张图片和一个 PDF，在第一台确认内容出现并打开或下载文件。从页头“更多 → 连接手机 / 电脑”复制当前地址并查看客户端入口；桌面安装说明见 [桌面 README](../apps/desktop/README.md)。原生客户端也填写实际验证可达的完整地址。重新创建 app 容器后检查原消息及附件仍在。

## 4. 已有部署升级和迁移

保留原项目和数据路径，不移动或删除用户数据：

1. 在 Docker 界面查看现有 app 的 `/data` 映射，记录真实宿主路径、原项目名及镜像版本。停止服务后保存整个数据目录的副本，并导出原 Compose 配置；备份说明见下方。
2. 在**原项目**使用基础模板，将原相对 source 改成指向原目录的绝对 source；保留现有口令、端口与自定义限制。修改镜像版本前先确认目标版本及备份可恢复。
3. 如果旧服务使用固定容器名，停止旧服务，由同一项目重新部署；只移除旧容器对象，不删除数据，也不要执行 `down -v`。
4. 重启后检查已有消息和附件，再从另一设备发送新内容。若失败，停止并检查原配置和目录，保留备份。
5. 若已经误建第二个空目录，停止错误项目，依据原容器卷映射找回原目录；保留所有候选目录，不自动合并两个数据库。

## 5. HTTPS 和外网（可选）

优先使用 NAS 已有反向代理：将 HTTPS 域名代理到已有 app 的宿主端口（例如 `http://127.0.0.1:8787`，端口以实际配置为准）。在**同一个基础项目**把 `SECURE_COOKIE` 改为 `"true"` 并重新部署。浏览器和原生客户端改用已验证可达的 HTTPS 地址；不能保证原 HTTP 地址同时保持浏览器会话。局域网 IP 不会因为把 `http` 改成 `https` 就在外网可达。

### Caddy 叠加配置

需要域名解析到主机且外部 80/443 端口可达；Caddy 的证书服务不提供内网穿透。保留原项目名、基础文件和数据目录，将 [Caddyfile](../deploy/Caddyfile) 保存为**基础 Compose 文件所在项目目录**的 `Caddyfile` 并替换域名，再把 [叠加文件](../deploy/docker-compose.caddy.yml) 保存为同目录 `compose.caddy.yml`。其中 `./Caddyfile`、`./caddy-data` 和 `./caddy-config` 均相对于基础文件所在项目目录解析；保留证书和配置目录。

叠加文件不能单独运行。假设原项目名为 `sendtomyself`，基础文件为 `/实际项目目录/compose.yml`：

```bash
docker compose -p sendtomyself -f /实际项目目录/compose.yml -f /实际项目目录/compose.caddy.yml up -d
```

已有项目请将 `-p` 的名称替换为原项目名。仅支持一份 YAML 的图形界面，在原项目的 `services` 下合入叠加文件中的 **`caddy` service 整段**，并将原 `app.environment.SECURE_COOKIE` 改为 `"true"`；不要新建项目或复制第二个 app。Caddy 经同一 Compose 网络访问 `app:8787`。

确认 HTTPS 地址及原有记录、附件可用后，可在基础文件的 `app.ports` 把 `"8787:8787"` 改为 `"127.0.0.1:8787:8787"`（已改宿主端口则保留该端口），再重新部署同一项目。Caddy 仍访问 `app:8787`。

### Nginx 与 SSE

已有 Nginx 时，配置证书并代理到 app 的实际宿主端口；上传限制要与应用限制匹配。保留实时路径的关闭缓冲设置：

```nginx
server {
    listen 443 ssl;
    server_name 你的域名;
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    client_max_body_size 60m;
    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location /api/realtime {
        proxy_pass http://127.0.0.1:8787;
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 1h;
    }
}
```

如 NAS 反代界面不能关闭 SSE 缓冲，请查阅其配置方式或使用 Caddy；刷新可用于确认内容是否已保存。

## 6. 常见故障与备份

| 现象 | 首先检查 | 对应操作 |
|---|---|---|
| 浏览器打不开 | 容器状态、NAS IP、左侧宿主端口 | 使用正确端口，查看 app 启动日志；不先改口令 |
| 口令正确但刷新后仍未登录 | 当前地址是 HTTP 还是 HTTPS | HTTP 模板为 false，HTTPS 为 true；重新部署原项目 |
| 修改配置后出现空收件箱 | `/data` 的真实映射 | 停止错误项目，恢复原目录映射；保留两份目录 |
| 另一设备内容不实时出现 | 当前连接、反代 SSE 缓冲 | 刷新确认数据在；按对应反代说明关闭缓冲 |
| 出门后内网 IP 不可达 | 是否已有远程访问路径 | 使用已验证的远程地址；不能只把 http 改成 https |

## 备份与恢复

### 无需终端

以下以项目 `sendtomyself` 为例；在 NAS 实际的 Docker 项目、容器和文件管理界面操作，界面名称因设备而异。此流程尚待 NAS 真机核对。

备份：

1. 在 app 容器详情确认 `/data` 对应的宿主绝对目录，记录原项目名、核心固定镜像版本、数据路径和访问地址。
2. 导出或保存 Compose 配置及使用的环境文件；Caddy 用户另存叠加配置、Caddyfile 和证书配置。配置可能包含登录口令，与数据同样妥善保管，不要公开。
3. 停止 **app** 并确认已停止；Caddy 可以继续运行。在文件管理中复制**完整 data 目录**到另一备份目录，等待复制完成。保留存在的 `app.db`、`app.db-wal`、`app.db-shm`、`uploads` 和其他内容，不挑选文件或删除 WAL。
4. 重新启动 app，打开页面查看已有内容；将版本、路径记录和配置与备份一起保存。同一磁盘上的副本有助于误操作恢复，但不能替代磁盘损坏后的异机备份。

恢复和回退：

1. 使用备份记录的相同核心固定版本准备目标项目，保持 app 停止。新 NAS 可先创建项目、容器和 data 目录，但不要开始写入。
2. 保存当前配置，将当前 data 重命名为 `data.before-restore-日期时间`。将备份的完整 data 复制到原路径，不要与旧目录合并。
3. 确认 `/data` 映射仍指向原绝对路径，使用项目的重新部署或重建容器入口重建 app，不删除宿主目录。登录后查看旧文字、图片和 PDF，发送新内容并在第二台设备确认。
4. 失败时停止 app，另存本次恢复目录，将 `data.before-restore-...` 放回原路径，恢复原配置和镜像并重新部署。两个候选目录都保留至确认完成。

完整 data 副本与下方脚本快照包是不同形态，不能把图形界面副本当脚本包，也不能将只有 `app.db` 的目录当完整备份。完整数据库必须保留，`export.json` 不是完整恢复格式。已开始永久删除的内容不保证可恢复；恢复后相关清理将继续，详见 [STM-05](https://github.com/Starfie1d1272/send-to-myself/issues/47) 的后续实现。

### 高级脚本

需要 Bash、Docker Compose 和 tar，以及包含备份工具的现有 app 镜像；主机无需 Node、pnpm、SQLite 或 jq。取得本仓库的 `scripts/backup.sh`、`scripts/restore.sh` 和 `scripts/lib/deployment.sh`。必须传入实际原项目名、按部署顺序传入所有 Compose 文件；配置使用变量插值时显式传 `--env-file`。不传时脚本使用空环境文件，不读取当前目录 `.env`。路径可含空格。仅支持一个 app 和单一宿主 bind `/data`，不支持命名卷或拆分数据库及附件路径。

基础部署（将示例项目名替换为实际原项目名）：

```bash
scripts/backup.sh --file /实际项目目录/compose.yml --project-name sendtomyself --output /备份目录
scripts/restore.sh --file /实际项目目录/compose.yml --project-name sendtomyself --backup /备份目录/快照目录 --dry-run
scripts/restore.sh --file /实际项目目录/compose.yml --project-name sendtomyself --backup /备份目录/快照目录
```

Caddy 部署使用相同项目名和文件顺序：

```bash
scripts/backup.sh --file /实际项目目录/compose.yml --file /实际项目目录/compose.caddy.yml --project-name sendtomyself --output /备份目录
scripts/restore.sh --file /实际项目目录/compose.yml --file /实际项目目录/compose.caddy.yml --project-name sendtomyself --backup /备份目录/快照目录 --dry-run
```

备份短暂停止原运行的 app，快照数据库并校验附件，然后归档；停止状态保持停止。快照包含数据库、附件归档、manifest、JSON 和 `deployment/` 配置副本及 `deployment.json`。另行保存 Caddyfile 和其他外部配置。配置副本是调用时版本，可能已经改为尚未部署的新版本；元数据中的实际容器镜像才是备份时版本。恢复时先按该版本调整目标配置，完成验证后再升级。历史无 manifest 的快照仍可校验数据库和附件存在及大小，但无法证明文件哈希。

恢复先在实际 data 的父目录解包并校验，`--dry-run` 不停服务或更改 data。正式恢复保留 `data.before-restore-*`，运行中的 app 重建并检查健康；原先停止时仍停止，下次启动前须按原项目重建 app。若启动失败，保留新旧两个目录，按上面的图形界面回退步骤恢复原目录、配置与镜像。成功后仍需登录、查看和下载旧附件，并从另一设备发送新内容。异常中断留下维护锁时，确认没有维护任务后再手动删除提示的锁目录。

## 源码开发

根目录 `docker-compose.yml` 用于源码本机构建，默认仅监听 `127.0.0.1:8787`，要求前置 HTTPS 反向代理。复制 `.env.example` 为 `.env` 并设置口令；本机 HTTP 直连时设 `SECURE_COOKIE=false`。它不是普通 NAS 镜像安装入口。
