#!/usr/bin/env bash
# Build the Tauri app on the Windows VM (compile check only — run pnpm tauri dev on the VM desktop to see the GUI)
# Usage: ./scripts/windows-vm-build.sh user@host password
#   or:  VM=user@host VM_PASS=password ./scripts/windows-vm-build.sh
set -euo pipefail

VM="${1:-${VM:-}}"
PASS="${2:-${VM_PASS:-}}"

if [ -z "$VM" ] || [ -z "$PASS" ]; then
  echo "Usage: $0 user@host password"
  echo "   or: VM=user@host VM_PASS=password $0"
  exit 1
fi

SSH="sshpass -p $PASS ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no"

$SSH "$VM" "cd C:\\work\\ship-studio && pnpm install && pnpm build && cd src-tauri && cargo build"
