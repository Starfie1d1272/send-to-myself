#!/usr/bin/env bash
# Shared maintenance targeting; caller owns cleanup and temporary directories.
die() { echo "错误：$*" >&2; exit 1; }
usage() { echo "用法: $0 --file COMPOSE [--file OVERLAY ...] --project-name NAME [--env-file ENV] $1" >&2; exit 1; }
parse_deployment() {
  local mode=$1; shift
  FILES=(); PROJECT=; ENV_FILE=; INPUT=; DRY=0
  while (($#)); do
    case "$1" in
      --file|--project-name|--env-file|--output|--backup)
        (($# >= 2)) || usage "$mode"; local opt=$1 val=$2; shift 2
        case "$opt" in
          --file) [ -f "$val" ] || die "配置文件不存在: $val"; FILES+=("$(cd "$(dirname "$val")" && pwd -P)/$(basename "$val")") ;;
          --project-name) [ -z "$PROJECT" ] || usage "$mode"; PROJECT=$val ;;
          --env-file) [ -z "$ENV_FILE" ] || usage "$mode"; [ -f "$val" ] || die "环境文件不存在: $val"; ENV_FILE="$(cd "$(dirname "$val")" && pwd -P)/$(basename "$val")" ;;
          --output) [ "$mode" = backup ] && [ -z "$INPUT" ] || usage "$mode"; INPUT=$val ;;
          --backup) [ "$mode" = restore ] && [ -z "$INPUT" ] || usage "$mode"; INPUT=$val ;;
        esac ;;
      --dry-run) [ "$mode" = restore ] && [ "$DRY" = 0 ] || usage "$mode"; DRY=1; shift ;;
      *) usage "$mode" ;;
    esac
  done
  [ ${#FILES[@]} -gt 0 ] && [ -n "$PROJECT" ] && [ -n "$INPUT" ] || usage "$mode"
  EMPTY_ENV=$(mktemp "${TMPDIR:-/tmp}/stm-empty-env.XXXXXX")
  COMPOSE=(docker compose --project-name "$PROJECT" --project-directory "$(dirname "${FILES[0]}")" --env-file "${ENV_FILE:-$EMPTY_ENV}")
  local f; for f in "${FILES[@]}"; do COMPOSE+=(--file "$f"); done
  "${COMPOSE[@]}" config --quiet || die "Compose 配置无法解析"
}
locate_deployment() {
  local ids id one project service mount envcheck configured
  ids=$(docker ps -aq --filter "label=com.docker.compose.project=$PROJECT" --filter label=com.docker.compose.service=app) || die "无法查询容器"
  local -a matches=()
  for id in $ids; do
    one=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.oneoff" }}' "$id") || die "无法读取容器"
    [ "$one" = true ] || matches+=("$id")
  done
  [ ${#matches[@]} -eq 1 ] || die "需要恰好一个 app 容器（找到 ${#matches[@]} 个）；新项目请先创建但不启动"
  CID=${matches[0]}
  project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$CID")
  service=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.service" }}' "$CID")
  [ "$project" = "$PROJECT" ] && [ "$service" = app ] || die "容器标签不匹配"
  STATE=$(docker inspect --format '{{.State.Status}}' "$CID")
  case "$STATE" in running|exited|created) ;; *) die "app 状态 $STATE 不适合维护，请先使其运行或停止" ;; esac
  IMAGE_ID=$(docker inspect --format '{{.Image}}' "$CID")
  IMAGE_REF=$(docker inspect --format '{{.Config.Image}}' "$CID")
  mount=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Type}}|{{.Source}}{{"\n"}}{{end}}{{end}}' "$CID")
  [[ "$mount" == bind\|* && "$mount" != *$'\n'* ]] || die "不支持此部署布局：/data 必须是单一 bind mount"
  DATA=${mount#bind|}; [ -d "$DATA" ] && [ -r "$DATA" ] || die "数据目录不存在或不可读"
  DATA=$(cd "$DATA" && pwd -P); [ "$DATA" != / ] || die "拒绝根目录作为 data"
  envcheck=$(docker inspect --format '{{range .Config.Env}}{{if or (eq . "DB_PATH=/data/app.db") (eq . "STORAGE_ROOT=/data/uploads")}}{{println .}}{{end}}{{end}}' "$CID")
  [[ "$envcheck" == *'DB_PATH=/data/app.db'* && "$envcheck" == *'STORAGE_ROOT=/data/uploads'* ]] || die "不支持此部署布局：DB_PATH 或 STORAGE_ROOT 不符合约定"
  configured=$("${COMPOSE[@]}" config --format json | docker run --rm -i --entrypoint node "$IMAGE_ID" -e '
    let s="";process.stdin.on("data",x=>s+=x);process.stdin.on("end",()=>{try{const a=JSON.parse(s).services.app;const v=a.volumes.filter(x=>x.target==="/data");if(v.length!==1||v[0].type!=="bind"||!v[0].source)process.exit(2); console.log(v[0].source);console.log(a.image||"")}catch{process.exit(2)}})') || die "不支持此部署布局：Compose /data 必须是单一 bind"
  CONFIG_DATA=${configured%%$'\n'*}; CONFIG_IMAGE=${configured#*$'\n'}
  [ -d "$CONFIG_DATA" ] || die "配置的 data 目录不存在"
  CONFIG_DATA=$(cd "$CONFIG_DATA" && pwd -P)
  [ "$CONFIG_DATA" = "$DATA" ] || die "Compose data 与容器实际挂载不一致，未停服"
  PARENT=$(dirname "$DATA"); BASE=$(basename "$DATA")
  LOCK="$PARENT/.$BASE.maintenance.lock"
  mkdir "$LOCK" 2>/dev/null || die "维护锁已存在或无法创建：$LOCK；确认无维护任务后手动清理"
  LOCK_OWNED=1
}
health() {
  local i state
  for ((i=0;i<30;i++)); do
    state=$(docker inspect --format '{{.State.Status}}' "$CID") || return 1
    [ "$state" = running ] || return 1
    if docker exec "$CID" node -e 'fetch("http://127.0.0.1:"+(process.env.PORT||8787)+"/health").then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))' >/dev/null 2>&1; then return 0; fi
    sleep 2
  done
  return 1
}
