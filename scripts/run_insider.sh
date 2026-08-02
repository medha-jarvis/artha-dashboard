#!/bin/bash
# Insider Engine — runs Mon-Fri 6:00 PM IST (12:30 UTC) from VPS cron
set -euo pipefail

export SUPABASE_URL="https://jljwgwftuqrabfyiucfl.supabase.co"
export SUPABASE_KEY="$(cat /root/.env.artha 2>/dev/null | grep SUPABASE_KEY | cut -d= -f2 || echo '')"
export TELEGRAM_BOT_TOKEN="$(cat /root/.env.artha 2>/dev/null | grep TELEGRAM_BOT_TOKEN | cut -d= -f2 || echo '')"
export TELEGRAM_CHAT_ID="$(cat /root/.env.artha 2>/dev/null | grep TELEGRAM_CHAT_ID | cut -d= -f2 || echo '')"

LOG="/root/artha-dashboard/logs/insider_$(date +%Y%m%d).log"
mkdir -p "$(dirname "$LOG")"

echo "=== Insider run $(date) ===" >> "$LOG"
cd /root/artha-dashboard
python3 scripts/insider_engine.py >> "$LOG" 2>&1
echo "=== done $(date) ===" >> "$LOG"
