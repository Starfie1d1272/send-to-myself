#!/usr/bin/env bash
# 完整校验数据库、附件归档与 SHA-256；dry-run 不改变现网数据。
# 用法：scripts/restore.sh <备份目录> [--dry-run]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
DATA="$ROOT/data"
SRC="${1:-}"
DRY=""
[ "${2:-}" = "--dry-run" ] && DRY=1
[ "${1:-}" = "--dry-run" ] && { DRY=1; SRC="${2:-}"; }
if [ -z "$SRC" ] || [ ! -d "$SRC" ]; then
  echo "用法: scripts/restore.sh <备份目录> [--dry-run]"; exit 1
fi
SRC="$(cd "$SRC" && pwd)"
[ -f "$SRC/app.db" ] || { echo "✗ 缺少 $SRC/app.db"; exit 1; }
STAGE="$(mktemp -d "$ROOT/.restore-XXXXXX")"
OLD=""
RESTART=0
cleanup() {
  local status=$?
  rm -rf "$STAGE"
  if [ "$RESTART" = 1 ]; then docker compose start app || status=1; fi
  exit "$status"
}
trap cleanup EXIT
cp "$SRC/app.db" "$STAGE/app.db"
[ ! -f "$SRC/manifest.json" ] || cp "$SRC/manifest.json" "$STAGE/manifest.json"
mkdir -p "$STAGE/uploads"
if [ -f "$SRC/uploads.tar.gz" ]; then
  # 只接受 uploads/ 下的常规文件/目录，拒绝越界路径及符号/硬链接。
  tar -tzf "$SRC/uploads.tar.gz" | awk '
    $0 !~ /^uploads\// || $0 ~ /(^|\/)\.\.(\/|$)/ { bad=1 }
    END { exit bad }'
  tar -tvzf "$SRC/uploads.tar.gz" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" { bad=1 } END { exit bad }'
  tar -xzf "$SRC/uploads.tar.gz" --no-same-owner --no-same-permissions -C "$STAGE"
fi
echo "校验数据库、附件及校验清单…"
docker compose run --rm --no-deps -T -v "$STAGE:/restore" app \
  node --import tsx src/lib/backup.ts verify /restore /restore/uploads
if [ -n "$DRY" ]; then
  echo "✓ 演练通过（数据库、全部附件已验证；未改动现网数据）。"; exit 0
fi
# 已停服务的部署恢复后保持停服；运行中的部署恢复后重新启动。
if docker compose ps --status running --services | awk '$0 == "app" { found=1 } END { exit !found }'; then
  RESTART=1
fi
docker compose stop app
if [ -d "$DATA" ]; then
  OLD="$(mktemp -d "$ROOT/data.before-restore-$(date +%Y%m%d-%H%M%S)-XXXXXX")"
  rmdir "$OLD"
  mv "$DATA" "$OLD"
fi
if ! mv "$STAGE" "$DATA"; then
  [ -z "$OLD" ] || mv "$OLD" "$DATA"
  exit 1
fi
if [ "$RESTART" = 1 ]; then docker compose start app; RESTART=0; fi
echo "✓ 恢复完成。恢复前的数据保留在: ${OLD:-（此前无数据）}"
