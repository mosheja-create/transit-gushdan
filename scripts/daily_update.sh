#!/usr/bin/env bash
# Daily refresh: downloads the latest Ministry of Transport GTFS, builds today's full-day data file,
# rebuilds the prototype and the site in public/, and runs the tests. Run by the systemd user timer transit-daily.timer
# (see docs/REALTIME.md and docs/SITE.md); safe to run by hand too.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/cache
exec >>data/cache/daily_update.log 2>&1
echo "=== $(date '+%F %T')"
python3 scripts/build_gtfs_data.py --refresh --date "$(TZ=Asia/Jerusalem date +%F)"
python3 scripts/build_prototype.py
node tests/routing_test.js | tail -1
# the site (public/) for local use; the published copy is rebuilt by GitHub Actions (.github/workflows/deploy.yml)
scripts/build_site.sh
node tests/engine_test.mjs | tail -1
# keep a week of daily files; older ones are not used by anything
find data -maxdepth 1 -name 'tlv_*_full.json' -mtime +7 -print -delete
echo "=== done $(date '+%F %T')"
