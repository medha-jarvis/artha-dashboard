#!/bin/bash
set -e
source /root/.env.artha
cd /root/artha-dashboard
python3 scripts/promoter_returns_updater.py >> /tmp/promoter_returns.log 2>&1
