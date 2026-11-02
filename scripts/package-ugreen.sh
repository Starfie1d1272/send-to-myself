#!/usr/bin/env bash
set -euo pipefail
usage() {
  cat <<'HELP'
Usage: scripts/package-ugreen.sh --version X.Y.Z --build 1..9999 [--arch amd64|arm64|all] --output DIR
Example: scripts/package-ugreen.sh --version 1.0.2 --build 1 --arch all --output ./ugreen-output
Requires Linux, Docker, ugcli, gh, Python 3 and a published core release and matching GHCR image.
The output directory must be empty. No upload or NAS installation is performed.
HELP
}
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }
version= build= output= arch=all
while (($#)); do
  case "$1" in
    --help|-h) usage; exit 0 ;;
    --version|--build|--arch|--output)
      (($# >= 2)) || die "Missing value for $1"
      case "$1" in --version) version=$2;; --build) build=$2;; --arch) arch=$2;; --output) output=$2;; esac
      shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done
[[ $(uname -s) == Linux ]] || die 'UPKs must be built on Linux'
[[ $version =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] || die 'Version must be a numeric X.Y.Z release'
[[ $build =~ ^[1-9][0-9]{0,3}$ ]] || die 'Build must be an integer from 1 to 9999'
[[ $arch == all || $arch == amd64 || $arch == arm64 ]] || die 'Invalid architecture'
[[ -n $output ]] || die 'Output directory is required'
for cmd in docker ugcli gh python3 sha256sum; do command -v "$cmd" >/dev/null || die "$cmd is required"; done
[[ ! -e $output || -d $output ]] || die 'Output is not a directory'
if [[ -d $output ]] && [[ -n $(ls -A -- "$output") ]]; then die 'Output directory must be empty'; fi
release=$(gh api "repos/Starfie1d1272/send-to-myself/releases/tags/v$version") || die 'Core release not found'
RELEASE_JSON=$release python3 -c 'import json,os,sys; r=json.loads(os.environ["RELEASE_JSON"]); sys.exit(bool(r.get("draft") or r.get("prerelease")))' || die 'Core release is draft or prerelease'
release_revision=$(gh api "repos/Starfie1d1272/send-to-myself/commits/v$version" --jq .sha) || die 'Cannot resolve release revision'
[[ $release_revision =~ ^[0-9a-f]{40}$ ]] || die 'Invalid release revision'
ugcli_version=$(ugcli --version)
printf 'Using %s\n' "$ugcli_version"
repo=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cp -R "$repo/deploy/ugreen/project.yaml" "$repo/deploy/ugreen/rootfs_common" "$work/"
image="ghcr.io/starfie1d1272/send-to-myself:$version"
python3 - "$work" "$version" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); v = sys.argv[2]
for name, old, new in [('project.yaml', 'version: "1.0.2"', f'version: "{v}"'), ('rootfs_common/docker-compose.yaml', 'send-to-myself:1.0.2', f'send-to-myself:{v}')]:
    f = p / name; s = f.read_text(); assert s.count(old) == 1; f.write_text(s.replace(old, new))
PY
arches=($arch); [[ $arch == all ]] && arches=(amd64 arm64)
mkdir -p "$work/result"
# Resolve the multi-platform index once, so a moving tag cannot mix releases.
docker buildx imagetools inspect --raw "$image" > "$work/index.json"
for a in "${arches[@]}"; do
  # Each pack contains only this architecture's rootfs; keep the source template dual-arch.
  python3 - "$work/project.yaml" "$a" <<'PYARCH'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1]); text = path.read_text()
text, count = re.subn(r'^support_arch: \[[^\n]*\]$', f'support_arch: [{sys.argv[2]}]', text, flags=re.M)
if count != 1: raise SystemExit('Expected one support_arch declaration')
path.write_text(text)
PYARCH
  child_digest=$(python3 - "$work/index.json" "$a" <<'PYCODE'
import json, re, sys
index = json.load(open(sys.argv[1])); arch = sys.argv[2]
matches = [m['digest'] for m in index.get('manifests', []) if m.get('platform', {}).get('os') == 'linux' and m.get('platform', {}).get('architecture') == arch]
if len(matches) != 1 or not re.fullmatch(r'sha256:[0-9a-f]{64}', matches[0]): raise SystemExit('Missing or ambiguous platform manifest: ' + arch)
print(matches[0])
PYCODE
  ) || die "Cannot resolve manifest for $a"
  digest="${image%:*}@$child_digest"
  docker pull --platform "linux/$a" "$digest"
  docker tag "$digest" "$image"
  actual=$(docker image inspect --format '{{.Architecture}}' "$image")
  [[ $actual == "$a" ]] || die "Image architecture is $actual, expected $a"
  id=$(docker image inspect --format '{{.Id}}' "$image")
  revision=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
  [[ $revision == "$release_revision" ]] || die "OCI revision for $a does not match release commit"
  mkdir -p "$work/rootfs_$a/images"
  tarfile="$work/rootfs_$a/images/image.tar"
  docker save -o "$tarfile" "$image"
  python3 - "$tarfile" "$image" "$id" "$a" "$revision" <<'PY'
import hashlib, json, sys, tarfile
path, tag, image_id, arch, revision = sys.argv[1:]
with tarfile.open(path) as tar:
    manifest = json.load(tar.extractfile('manifest.json'))
    if len(manifest) != 1 or manifest[0].get('RepoTags') != [tag]: raise SystemExit('Unexpected image tags in archive')
    raw = tar.extractfile(manifest[0]['Config']).read()
    config = json.loads(raw)
    if 'sha256:' + hashlib.sha256(raw).hexdigest() != image_id or config.get('architecture') != arch or config.get('config', {}).get('Labels', {}).get('org.opencontainers.image.revision') != revision:
        raise SystemExit('Archive image ID, architecture or revision mismatch')
PY
  (cd "$work" && ugcli check && ugcli pack --build "$build" --arch "$a" --product-series nasync)
  printf -v fullbuild '%04d' "$build"
  upk="${a}_nasync_com.starfie1d.sendtomyself_${version}.${fullbuild}.upk"
  [[ -s "$work/build_dir/pkgs/upk/$upk" ]] || die "Expected UPK not found: $upk"
  cp "$work/build_dir/pkgs/upk/$upk" "$work/result/"
  python3 - "$work/result/$a.json" "$a" "$digest" "$id" "$revision" "$upk" <<'PY'
import json, sys
p, arch, digest, image_id, revision, upk = sys.argv[1:]
with open(p, 'w') as f: json.dump(dict(architecture=arch, image_digest=digest, image_id=image_id, source_revision=revision, upk=upk), f)
PY
  rm -rf "$work/rootfs_$a" "$work/build_dir"
done
python3 - "$work/result" "$version" "$build" "$ugcli_version" "${arches[@]}" <<'PY'
import datetime, json, pathlib, sys
p=pathlib.Path(sys.argv[1]); entries=[]
for arch in sys.argv[5:]:
    f=p/(arch+'.json'); entries.append(json.loads(f.read_text())); f.unlink()
manifest=dict(core_version=sys.argv[2], build=int(sys.argv[3]), ugcli_version=sys.argv[4], generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat(), images=entries)
(p/'manifest.json').write_text(json.dumps(manifest, indent=2, ensure_ascii=False)+'\n')
PY
(cd "$work/result" && sha256sum ./*.upk manifest.json > SHA256SUMS)
mkdir -p "$output"
cp "$work/result/"* "$output/"
printf 'UPKs and manifest written to %s\n' "$output"
