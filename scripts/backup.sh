#!/usr/bin/env bash
# SendToMyself 备份（SPEC §13）。
# 在线一致性快照（兼容 WAL）+ 附件目录 + 人类可读 JSON 导出。
# 用法：scripts/backup.sh [输出目录]    默认输出到 ./backups
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/data"
OUT="${1:-$ROOT/backups}"
TS="$(date +%Y%m%d-%H%M%S)"
DEST="$OUT/stm-$TS"
mkdir -p "$DEST"

echo "[1/3] 数据库在线快照…"
# 用容器内 better-sqlite3 做在线 backup，避免直接 cp WAL 造成不一致
docker compose exec -T app node -e '
const Database = require("better-sqlite3");
const db = new Database(process.env.DB_PATH);
db.pragma("wal_checkpoint(TRUNCATE)");
db.backup("/data/_backup.db")
  .then(() => { db.close(); console.log("  ok"); })
  .catch((e) => { console.error(e); process.exit(1); });
'
mv "$DATA/_backup.db" "$DEST/app.db"

echo "[2/3] 附件目录打包…"
if [ -d "$DATA/uploads" ]; then
  tar -czf "$DEST/uploads.tar.gz" -C "$DATA" uploads
  echo "  ok"
else
  echo "  （暂无附件）"
fi

echo "[3/3] JSON 导出…"
docker compose exec -T app node -e '
const Database = require("better-sqlite3");
const db = new Database(process.env.DB_PATH, { readonly: true });
const items = db.prepare("SELECT * FROM items").all();
const attachments = db.prepare("SELECT * FROM attachments").all();
process.stdout.write(JSON.stringify({ exportedAt: new Date().toISOString(), items, attachments }, null, 2));
' > "$DEST/export.json"
echo "  ok"

echo "✓ 备份完成: $DEST"
echo "  注意：JSON 导出含敏感内容明文，请妥善保管；服务端口令(.env)不在备份内。"
