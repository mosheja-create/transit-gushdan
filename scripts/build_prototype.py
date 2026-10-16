"""Builds prototype-web/dist/index.html: the prototype page with a Tel Aviv GTFS data file inlined.

Usage: python3 scripts/build_prototype.py [data/<file>.json]
Without an argument it takes today's full-day file (data/tlv_<date>_full.json, from scripts/build_gtfs_data.py),
else the newest one, else the older Open Bus window file.
"""
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

root = Path(__file__).resolve().parent.parent
if len(sys.argv) > 1:
    data_path = Path(sys.argv[1]).resolve()
else:
    # today's file if there is one (live data only applies to today), else the newest
    today = datetime.now(ZoneInfo("Asia/Jerusalem")).date().isoformat()
    full = sorted((root / "data").glob("tlv_*_full.json"))
    todays = [f for f in full if f.name == f"tlv_{today}_full.json"]
    data_path = (todays or full or [root / "data" / "tlv_2026-10-15_0700-0930.json"])[-1]
src = (root / "prototype-web" / "index.html").read_text(encoding="utf-8")
data = json.loads(data_path.read_text(encoding="utf-8"))
blob = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
marker = "/*__TLV_DATA__*/null"
assert src.count(marker) == 1, "data marker missing"
out = root / "prototype-web" / "dist" / "index.html"
out.parent.mkdir(exist_ok=True)
page = src.replace(marker, blob)
if not page.lstrip().lower().startswith("<!doctype"):
    # the source is an Artifact page body; give the local copy its own skeleton so it opens correctly from disk or a plain server
    page = '<!doctype html>\n<html lang="he" dir="rtl">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n' + page
out.write_text(page, encoding="utf-8")
print(f"wrote {out.relative_to(root)} ({out.stat().st_size:,} bytes) with {data_path.relative_to(root)}")
