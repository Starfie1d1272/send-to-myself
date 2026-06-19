#!/usr/bin/env bash
# SendToMyself 恢复（SPEC §13：未恢复过的备份等于无备份）。
# 用法：scripts/restore.sh <某次备份目录 如 backups/stm-20260619-200000>
# 会停服 → 覆盖 data/ → 重启。建议先用 --dry-run 验证备份可读。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$ROOT/data"
SRC="${1:-}"
DRY=""
[ "${2:-}" = "--dry-run" ] && DRY=1
[ "${1:-}" = "--dry-run" ] && { DRY=1; SRC="${2:-}"; }

if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "用法: scripts/restore.sh <备份目录> [--dry-run]"; exit 1
fi
[ -f "$SRC/app.db" ] || { echo "✗ 缺少 $SRC/app.db"; exit 1; }

echo "校验数据库完整性…"
docker compose run --rm -T -v "$(cd "$SRC" && pwd):/restore:ro" app node -e '
const Database = require("better-sqlite3");
const db = new Database("/restore/app.db", { readonly: true });
const r = db.pragma("integrity_check", { simple: true });
const n = db.prepare("SELECT COUNT(*) c FROM items").get().c;
if (r !== "ok") { console.error("integrity:", r); process.exit(1); }
console.log("  完整性 ok，items =", n);
'

if [ -n "$DRY" ]; then
  echo "✓ 演练通过（未改动现网数据）。去掉 --dry-run 执行真正恢复。"; exit 0
fi

echo "停止服务…"; docker compose stop app
echo "恢复数据库与附件…"
mkdir -p "$DATA"
cp "$SRC/app.db" "$DATA/app.db"
rm -f "$DATA/app.db-wal" "$DATA/app.db-shm"
if [ -f "$SRC/uploads.tar.gz" ]; then
  rm -rf "$DATA/uploads"
  tar -xzf "$SRC/uploads.tar.gz" -C "$DATA"
fi
echo "重启服务…"; docker compose start app
echo "✓ 恢复完成。"
