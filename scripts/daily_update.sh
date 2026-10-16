#!/usr/bin/env bash
# Daily refresh: downloads the latest Ministry of Transport GTFS, builds today's full-day data file,
# rebuilds the prototype and runs the routing tests. Run by the systemd user timer transit-daily.timer
# (see docs/DAILY_UPDATE.md); safe to run by hand too.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/cache
exec >>data/cache/daily_update.log 2>&1
echo "=== $(date '+%F %T')"
python3 scripts/build_gtfs_data.py --refresh --date "$(TZ=Asia/Jerusalem date +%F)"
python3 scripts/build_prototype.py
node tests/routing_test.js | tail -1
# keep a week of daily files; older ones are not used by anything
find data -maxdepth 1 -name 'tlv_*_full.json' -mtime +7 -print -delete
echo "=== done $(date '+%F %T')"
