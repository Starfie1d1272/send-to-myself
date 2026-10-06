#!/usr/bin/env bash
# 一致性备份：短暂停服，SQLite 快照 + 附件 + 校验清单 + 同一快照的 JSON。
# 用法：scripts/backup.sh [输出目录]；服务恢复成功后才公布备份目录。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DATA="$ROOT/data"
OUT="${1:-$ROOT/backups}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
DEST="$(mktemp -d "$OUT/.stm-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
RESTART=0
cleanup() {
  local status=$?
  if [ "$RESTART" = 1 ]; then docker compose start app || status=1; fi
  if [ "$status" != 0 ]; then rm -rf "$DEST"; fi
  exit "$status"
}
trap cleanup EXIT
if ! docker compose ps --status running --services | awk '$0 == "app" { found=1 } END { exit !found }'; then
  echo "✗ app 未运行；请先启动服务。" >&2; exit 1
fi
RESTART=1
docker compose stop app
echo "[1/3] 数据库快照、附件 SHA-256 与 JSON 导出…"
docker compose run --rm --no-deps -T -v "$DEST:/backup" app \
  node --import tsx src/lib/backup.ts snapshot /backup /data/uploads
echo "[2/3] 附件打包…"
if [ -d "$DATA/uploads" ]; then tar -czf "$DEST/uploads.tar.gz" -C "$DATA" uploads; fi
echo "[3/3] 恢复服务…"
docker compose start app
RESTART=0
FINAL="$OUT/$(basename "$DEST" | cut -c 2-)"
mv "$DEST" "$FINAL"
echo "✓ 备份完成: $FINAL"
echo "  JSON/数据库含敏感内容；请妥善保管。服务端口令(.env)不在备份内。"
