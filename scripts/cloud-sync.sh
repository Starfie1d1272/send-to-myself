#!/usr/bin/env bash
# Refresh a clean default cloud checkout without overwriting task work.
set -euo pipefail
repo_dir=${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}
cd "$repo_dir"

if [[ -n "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "[cloud-sync] Local changes found; keeping the checkout unchanged."
  exit 0
fi

branch=$(git branch --show-current)
case "$branch" in
  main|work) ;;
  *)
    echo "[cloud-sync] Keeping task branch or detached checkout unchanged."
    exit 0
    ;;
esac

git fetch origin main
if ! git merge-base --is-ancestor HEAD FETCH_HEAD; then
  echo "[cloud-sync] Local commits differ from origin/main; keeping them unchanged."
  exit 0
fi
git pull --ff-only origin main
