# NAS 运维包快速入口

本包的 Compose 已锁定为 `VERSION.json` 中的核心镜像 tag。先核验下载页提供的 ZIP SHA256，解压后在包根目录运行 `sha256sum -c SHA256SUMS`（macOS 可用 `shasum -a 256 -c SHA256SUMS`），对照 `VERSION.json` 的版本、源码 SHA、镜像 tag 和 digest 与发布记录。候选包仅供测试；各版本是否提供 NAS 运维 ZIP，请查看对应发布页。完整步骤见[部署指南](https://github.com/Starfie1d1272/send-to-myself/blob/main/docs/DEPLOY.md)。

在解压目录编辑 `docker-compose.yml`：先创建专用 data 目录，填写 `AUTH_PASSWORD` 和该目录的真实绝对 `source`。Compose 口令中的 `$` 写为 `$$`；端口冲突时修改左侧宿主端口。局域网 HTTP 使用 `SECURE_COOKIE: "false"`；远程使用 HTTPS，按完整指南配置 `docker-compose.caddy.yml`、`Caddyfile` 和安全 Cookie。记录项目名、镜像版本及数据路径。

```bash
docker compose -p sendtomyself -f docker-compose.yml up -d
scripts/backup.sh --file docker-compose.yml --project-name sendtomyself --output /实际备份目录
scripts/restore.sh --file docker-compose.yml --project-name sendtomyself --backup /实际备份目录/快照目录 --dry-run
scripts/restore.sh --file docker-compose.yml --project-name sendtomyself --backup /实际备份目录/快照目录
```

HTTPS 项目要按部署顺序传入两个 `--file`；使用变量插值时传 `--env-file`。备份和恢复前阅读完整指南，确认实际项目名、路径与版本。回退使用升级前完整备份及对应旧版本；保存现有数据，不合并目录。包内含上述 Compose、Caddyfile、`scripts/backup.sh`、`scripts/restore.sh`、`scripts/lib/deployment.sh`、`VERSION.json` 和 `SHA256SUMS`。
