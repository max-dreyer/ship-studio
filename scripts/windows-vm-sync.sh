#!/usr/bin/env bash
# Sync repo source to the Windows VM (incremental, sends only changed files)
# Deletions are not synced — use --all for a full sync
# Usage: ./scripts/windows-vm-sync.sh [user@host password] [--all]
#   or:  VM=user@host VM_PASS=password ./scripts/windows-vm-sync.sh [--all]
set -euo pipefail

VM="${1:-${VM:-}}"
PASS="${2:-${VM_PASS:-}}"

if [ -z "$VM" ] || [ -z "$PASS" ]; then
  echo "Usage: $0 user@host password [--all]"
  echo "   or: VM=user@host VM_PASS=password $0 [--all]"
  exit 1
fi

SRC="$(cd "$(dirname "$0")/.." && pwd)"
DEST="C:\\work\\ship-studio"
SSH="sshpass -p $PASS ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no"
STAMP="$SRC/.last-sync"

EXCLUDES=(
  --exclude=.git --exclude=node_modules --exclude=target
  --exclude=dist --exclude=dist-ssr --exclude=.DS_Store
  --exclude=.claude --exclude=.agents --exclude=.planning
  --exclude=.vscode --exclude=.idea --exclude=.last-sync
)

if [ "${3:-${1:-}}" = "--all" ] || [ ! -f "$STAMP" ]; then
  tar cf - -C "$SRC" "${EXCLUDES[@]}" . | $SSH "$VM" "cd $DEST && tar xf -"
  echo "Full sync to $VM:$DEST"
else
  SINCE=$(date -r "$STAMP" "+%Y-%m-%d %H:%M:%S")
  tar cf - -C "$SRC" "${EXCLUDES[@]}" --newer="$SINCE" . 2>/dev/null | $SSH "$VM" "cd $DEST && tar xf -"
  echo "Incremental sync to $VM:$DEST (changed since $SINCE)"
fi

touch "$STAMP"
