#!/usr/bin/env bash
# Launch pnpm tauri dev on the Windows VM desktop
# Usage: ./scripts/windows-vm-start.sh user@host password
#   or:  VM=user@host VM_PASS=password ./scripts/windows-vm-start.sh
set -euo pipefail

VM="${1:-${VM:-}}"
PASS="${2:-${VM_PASS:-}}"

if [ -z "$VM" ] || [ -z "$PASS" ]; then
  echo "Usage: $0 user@host password"
  echo "   or: VM=user@host VM_PASS=password $0"
  exit 1
fi

SSH="sshpass -p $PASS ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no -o StrictHostKeyChecking=no"

$SSH "$VM" "cd C:\\work\\ship-studio && pnpm install"

# Write batch file with pause on exit
$SSH "$VM" "( echo @echo off& echo cd /d C:\work\ship-studio& echo C:\Users\admin\AppData\Roaming\npm\pnpm.cmd tauri dev ^> C:\work\dev.log 2^>^&1& echo if errorlevel 1 pause ) > C:\work\run-dev.bat"

# Clear old log, run in interactive desktop session, then tail log
$SSH "$VM" "type nul > C:\\work\\dev.log 2>nul & schtasks /delete /tn TauriDev /f 2>nul & schtasks /create /tn TauriDev /tr C:\\work\\run-dev.bat /sc once /st 00:00 /f /rl highest /it && schtasks /run /tn TauriDev"

echo "App launching on VM desktop. Tailing logs..."
$SSH "$VM" "powershell -Command Get-Content C:\\work\\dev.log -Wait"
