#!/bin/bash
set -a
source /root/.env.artha
set +a
cd /root/artha-dashboard
python3 scripts/super_investor_engine.py >> logs/super_investor.log 2>&1
