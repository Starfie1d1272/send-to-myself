#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/lib/deployment.sh"
EMPTY_ENV="" LOCK_OWNED=0 STAGE="" RESTART=0 FINAL=""
cleanup() {
  local status=$?
  trap - EXIT
  if [ "$RESTART" = 1 ]; then
    if ! "${COMPOSE[@]}" start app || ! health; then
      [ -z "$FINAL" ] || echo "备份已保存：$FINAL；应用启动失败，请查看该项目日志" >&2
      status=1
    fi
  fi
  [ -z "$STAGE" ] || rm -rf -- "$STAGE"
  [ "$LOCK_OWNED" = 0 ] || rmdir -- "$LOCK"
  [ -z "$EMPTY_ENV" ] || rm -f -- "$EMPTY_ENV"
  exit "$status"
}
trap cleanup EXIT
parse_deployment backup "$@"
locate_deployment
mkdir -p -- "$INPUT"
OUT=$(cd "$INPUT" && pwd -P)
case "$OUT/" in "$DATA/"*) die "备份输出不能位于 data 内" ;; esac
STAGE=$(mktemp -d "$OUT/.stm-$(date +%Y%m%d-%H%M%S)-XXXXXX")
mkdir "$STAGE/deployment"
for i in "${!FILES[@]}"; do cp -- "${FILES[$i]}" "$STAGE/deployment/compose-$i.yml"; done
[ -z "$ENV_FILE" ] || cp -- "$ENV_FILE" "$STAGE/deployment/environment.env"
# Generate JSON inside the existing image; arguments are data, never shell code.
docker run --rm -i --entrypoint node "$IMAGE_ID" - "$PROJECT" "$IMAGE_REF" "$IMAGE_ID" "$DATA" "${ENV_FILE:+deployment/environment.env}" "${FILES[@]}" >"$STAGE/deployment.json" <<'NODE'
const [projectName,imageRef,imageId,dataSource,envFile,...files]=process.argv.slice(2);
console.log(JSON.stringify({formatVersion:1,createdAt:new Date().toISOString(),projectName,service:'app',imageRef,imageId,dataTarget:'/data',dataSource,composeFiles:files.map((path,i)=>({path,savedAs:`deployment/compose-${i}.yml`})),envFile:envFile||null},null,2));
NODE
[ "$CONFIG_IMAGE" = "$IMAGE_REF" ] || echo "注意：配置镜像 $CONFIG_IMAGE 与实际容器 $IMAGE_REF 不同；恢复时以 deployment.json 的实际版本为准。" >&2
if [ "$STATE" = running ]; then
  RESTART=1
  "${COMPOSE[@]}" stop app
fi
echo "创建数据库快照并校验附件…"
docker run --rm --entrypoint node --mount "type=bind,src=$DATA,dst=/data" --mount "type=bind,src=$STAGE,dst=/backup" "$IMAGE_ID" --import tsx src/lib/backup.ts snapshot /backup /data/uploads
echo "打包附件…"
if [ -d "$DATA/uploads" ]; then tar -czf "$STAGE/uploads.tar.gz" -C "$DATA" uploads; fi
# The staging basename starts with a dot; publish without it.
FINAL="$OUT/${STAGE##*/.}"
mv -- "$STAGE" "$FINAL"
STAGE=""
if [ "$RESTART" = 1 ]; then
  if "${COMPOSE[@]}" start app && health; then
    RESTART=0
    echo "备份完成：$FINAL；应用已恢复运行"
  else
    RESTART=0
    echo "备份已保存：$FINAL；应用启动失败，请查看该项目日志" >&2
    exit 1
  fi
else echo "备份完成：$FINAL；应用保持停止"; fi
