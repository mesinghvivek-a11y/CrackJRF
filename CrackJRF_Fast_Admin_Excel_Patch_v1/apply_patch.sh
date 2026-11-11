#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(pwd)"
PATCH_ROOT="$(cd "$(dirname "$0")" && pwd)"
PATCH_FILES="$PATCH_ROOT/patch"

if [[ ! -f "$REPO_ROOT/package.json" || ! -d "$REPO_ROOT/apps/admin" || ! -d "$REPO_ROOT/supabase/migrations" ]]; then
  echo "ERROR: Run this script from the CrackJRF repository root (the folder containing package.json, apps/ and supabase/)." >&2
  exit 1
fi
if [[ ! -d "$PATCH_FILES" ]]; then
  echo "ERROR: Patch source folder not found: $PATCH_FILES" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="/tmp/crackjrf-fast-admin-backup-$STAMP"
mkdir -p "$BACKUP_DIR"
while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  if [[ -e "$REPO_ROOT/$rel" ]]; then
    mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
    cp -a "$REPO_ROOT/$rel" "$BACKUP_DIR/$rel"
  fi
done < "$PATCH_ROOT/CHANGED_FILES.txt"

cp -a "$PATCH_FILES/." "$REPO_ROOT/"
while IFS= read -r rel; do
  [[ -z "$rel" ]] && continue
  rm -rf -- "$REPO_ROOT/$rel"
done < "$PATCH_ROOT/REMOVED_FILES.txt"

echo "Patch files copied. Backup of overwritten files: $BACKUP_DIR"
echo "Next: inspect git status, run git diff --check, apply migration 0004, then build Admin and Student."
