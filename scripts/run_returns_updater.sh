#!/bin/bash
# Insider Returns Updater — runs 1st of each month at 8 AM IST (2:30 UTC)
set -euo pipefail

export SUPABASE_URL="https://jljwgwftuqrabfyiucfl.supabase.co"
export SUPABASE_KEY="$(cat /root/.env.artha 2>/dev/null | grep SUPABASE_KEY | cut -d= -f2 || echo '')"

LOG="/root/artha-dashboard/logs/returns_updater_$(date +%Y%m).log"
mkdir -p "$(dirname "$LOG")"

echo "=== Returns Updater $(date) ===" >> "$LOG"
cd /root/artha-dashboard
python3 scripts/insider_returns_updater.py >> "$LOG" 2>&1
echo "=== done $(date) ===" >> "$LOG"
