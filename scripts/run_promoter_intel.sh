#!/bin/bash
set -e
source /root/.env.artha
cd /root/artha-dashboard
python3 scripts/promoter_intel_engine.py >> /tmp/promoter_intel.log 2>&1
