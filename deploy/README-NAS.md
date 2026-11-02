# NAS 运维包快速入口

此文件是计划中的 NAS 运维包内 `README-NAS.md` 唯一源；实际包生成后需从解压目录核对文件、镜像版本和命令。当前公开核心 1.0.2 未提供此 ZIP，安装请看[完整部署指南](https://github.com/Starfie1d1272/send-to-myself/blob/main/docs/DEPLOY.md)。

在解压目录编辑 `docker-compose.yml`：先创建专用 data 目录，填写 `AUTH_PASSWORD` 和该目录的真实绝对 `source`。Compose 口令中的 `$` 写为 `$$`；端口冲突时修改左侧宿主端口。局域网 HTTP 使用 `SECURE_COOKIE: "false"`；远程使用 HTTPS，按完整指南配置 `docker-compose.caddy.yml`、`Caddyfile` 和安全 Cookie。记录项目名、镜像版本及数据路径。

```bash
docker compose -p sendtomyself -f docker-compose.yml up -d
scripts/backup.sh --file docker-compose.yml --project-name sendtomyself --output /实际备份目录
scripts/restore.sh --file docker-compose.yml --project-name sendtomyself --backup /实际备份目录/快照目录 --dry-run
scripts/restore.sh --file docker-compose.yml --project-name sendtomyself --backup /实际备份目录/快照目录
```

HTTPS 项目要按部署顺序传入两个 `--file`；使用变量插值时传 `--env-file`。备份和恢复前阅读完整指南，确认实际项目名、路径与版本。回退使用升级前完整备份及对应旧版本；保存现有数据，不合并目录。包内预期含上述 Compose、Caddyfile、`scripts/backup.sh`、`scripts/restore.sh`、`scripts/lib/deployment.sh`、`VERSION.json` 和 `SHA256SUMS`；以实际生成并验证的产物为准。
