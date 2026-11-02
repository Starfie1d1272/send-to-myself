#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/deployment.sh"
EMPTY_ENV= LOCK_OWNED=0 STAGE= RESTART=0 OLD= SWAPPED=0
cleanup() {
  local status=$?
  trap - EXIT
  if [ "$RESTART" = 1 ] && [ "$SWAPPED" = 0 ]; then "${COMPOSE[@]}" start app && health || status=1; fi
  [ -z "$STAGE" ] || rm -rf -- "$STAGE"
  [ "$LOCK_OWNED" = 0 ] || rmdir -- "$LOCK"
  [ -z "$EMPTY_ENV" ] || rm -f -- "$EMPTY_ENV"
  exit "$status"
}
trap cleanup EXIT
parse_deployment restore "$@"
locate_deployment
[ -d "$INPUT" ] || die "备份目录不存在"
SRC=$(cd "$INPUT" && pwd -P)
case "$SRC/" in "$DATA/"*) die "备份源不能位于 data 内";; esac
[ -f "$SRC/app.db" ] || die "缺少 app.db"
STAGE=$(mktemp -d "$PARENT/.$BASE.restore-XXXXXX")
cp -- "$SRC/app.db" "$STAGE/app.db"
[ ! -f "$SRC/manifest.json" ] || cp -- "$SRC/manifest.json" "$STAGE/manifest.json"
mkdir "$STAGE/uploads"
if [ -f "$SRC/uploads.tar.gz" ]; then
  tar -tzf "$SRC/uploads.tar.gz" | awk '$0 !~ /^uploads\// || $0 ~ /(^|\/)\.\.(\/|$)/ {bad=1} END {exit bad}' || die "附件归档路径不安全"
  tar -tvzf "$SRC/uploads.tar.gz" | awk 'substr($0,1,1) != "-" && substr($0,1,1) != "d" {bad=1} END {exit bad}' || die "附件归档含链接或特殊文件"
  tar -xzf "$SRC/uploads.tar.gz" --no-same-owner --no-same-permissions -C "$STAGE"
fi
echo "校验数据库、附件及清单…"
docker run --rm --entrypoint node --mount "type=bind,src=$STAGE,dst=/restore" "$IMAGE_ID" --import tsx src/lib/backup.ts verify /restore /restore/uploads
if [ -f "$SRC/deployment.json" ]; then
  docker run --rm -i --entrypoint node "$IMAGE_ID" -e 'let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{let d=JSON.parse(s);console.log("备份来源镜像："+d.imageRef+"（"+d.imageId+"）")}catch{console.log("备份元数据无法读取；请查阅备份版本记录")}})' < "$SRC/deployment.json"
else echo "历史备份无部署元数据；请查阅备份版本记录。"; fi
echo "目标 Compose 镜像：$CONFIG_IMAGE；请使用备份时相同核心版本恢复，再升级。"
if [ "$DRY" = 1 ]; then echo "演练通过；应用状态和 data 未改变。"; exit 0; fi
if [ "$STATE" = running ]; then RESTART=1; "${COMPOSE[@]}" stop app; fi
OLD=$(mktemp -d "$PARENT/$BASE.before-restore-$(date +%Y%m%d-%H%M%S)-XXXXXX"); rmdir "$OLD"
mv -- "$DATA" "$OLD"
if ! mv -- "$STAGE" "$DATA"; then
  if ! mv -- "$OLD" "$DATA"; then echo "回退重命名失败；原数据：$OLD；待恢复数据：$STAGE" >&2; STAGE=; RESTART=0; fi
  echo "待恢复数据保留在：$STAGE" >&2; STAGE=
  die "无法替换 data"
fi
STAGE=; SWAPPED=1; RESTART=0
if [ "$STATE" = running ]; then
  if "${COMPOSE[@]}" up -d --no-deps --no-build --pull never --force-recreate app; then
    CID=$("${COMPOSE[@]}" ps -aq app)
    if health; then echo "恢复完成；恢复前数据保留在：$OLD"; exit 0; fi
  fi
  "${COMPOSE[@]}" stop app || true
  echo "恢复后启动或健康检查失败；恢复数据：$DATA；恢复前数据：$OLD。请按 docs/DEPLOY.md 回退。" >&2
  exit 1
fi
echo "数据已恢复；应用保持停止，下一次启动前按原项目重建 app。恢复前数据保留在：$OLD"
