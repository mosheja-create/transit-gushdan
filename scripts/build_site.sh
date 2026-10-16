#!/usr/bin/env bash
# Builds the site into public/: the timetable data for Gush Dan (today and the next days) and the page files.
# Usage: scripts/build_site.sh [--refresh] [--skip-data]
#   --refresh    download the Ministry of Transport GTFS again
#   --skip-data  only copy the page files (data already in public/data)
set -euo pipefail
cd "$(dirname "$0")/.."
refresh=""; skip_data=""
for a in "$@"; do
  case "$a" in
    --refresh) refresh="--refresh" ;;
    --skip-data) skip_data=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done
mkdir -p public/data
if [ -z "$skip_data" ]; then
  # days already over are dropped from the folder; the manifest lists what is left
  today=$(TZ=Asia/Jerusalem date +%F)
  for f in public/data/gushdan_*.json; do
    [ -e "$f" ] || continue
    d=$(basename "$f" .json); d=${d#gushdan_}
    [[ "$d" < "$today" ]] && rm -f "$f"
  done
  python3 scripts/build_gtfs_data.py $refresh --region gushdan --days 3 --out-dir public/data
fi
# page files: everything in site/ (the data folder is left alone)
cp -r site/. public/
touch public/.nojekyll
echo "site built in public/"
