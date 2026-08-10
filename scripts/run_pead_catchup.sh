#!/bin/bash
# PEAD catchup — runs Tue-Sat 7:30 AM IST (02:00 UTC) to score prior day's late filers
set -euo pipefail

export SUPABASE_URL="https://jljwgwftuqrabfyiucfl.supabase.co"
export SUPABASE_KEY="$(cat /root/.env.artha 2>/dev/null | grep SUPABASE_KEY | cut -d= -f2 || echo '')"
export TELEGRAM_BOT_TOKEN="$(cat /root/.env.artha 2>/dev/null | grep TELEGRAM_BOT_TOKEN | cut -d= -f2 || echo '')"
export TELEGRAM_CHAT_ID="$(cat /root/.env.artha 2>/dev/null | grep TELEGRAM_CHAT_ID | cut -d= -f2 || echo '')"

YESTERDAY=$(date -d 'yesterday' +%Y-%m-%d)
LOG="/root/artha-dashboard/logs/pead_catchup_$(date +%Y%m%d).log"
mkdir -p "$(dirname "$LOG")"

echo "=== PEAD catchup for $YESTERDAY at $(date) ===" >> "$LOG"
cd /root/artha-dashboard
python3 scripts/pead_engine.py "$YESTERDAY" >> "$LOG" 2>&1
echo "=== done $(date) ===" >> "$LOG"
