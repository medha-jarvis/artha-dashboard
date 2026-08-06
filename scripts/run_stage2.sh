#!/bin/bash
# Stage 2 Engine — runs Mon-Fri 5:00 PM IST (11:30 UTC) from VPS cron
set -euo pipefail

export SUPABASE_URL="https://jljwgwftuqrabfyiucfl.supabase.co"
export SUPABASE_KEY="$(cat /root/.env.artha 2>/dev/null | grep SUPABASE_KEY | cut -d= -f2 || echo '')"
export TELEGRAM_BOT_TOKEN="$(cat /root/.env.artha 2>/dev/null | grep TELEGRAM_BOT_TOKEN | cut -d= -f2 || echo '')"
export TELEGRAM_CHAT_ID="$(cat /root/.env.artha 2>/dev/null | grep TELEGRAM_CHAT_ID | cut -d= -f2 || echo '')"

LOG="/root/artha-dashboard/logs/stage2_$(date +%Y%m%d).log"
mkdir -p "$(dirname "$LOG")"

echo "=== Stage2 engine run $(date) ===" >> "$LOG"
cd /root/artha-dashboard
python3 scripts/stage2_engine.py >> "$LOG" 2>&1
echo "=== engine done $(date) ===" >> "$LOG"

echo "=== Stage2 tracker run $(date) ===" >> "$LOG"
python3 scripts/stage2_tracker.py >> "$LOG" 2>&1
echo "=== tracker done $(date) ===" >> "$LOG"
