"""Builds a full-day data file for the prototype from the Ministry of Transport GTFS.

Downloads israel-public-transportation.zip (once; --refresh to download again), then keeps:
  - every bus, light rail and shared taxi trip of the chosen date, cut to the stops inside one city or a region;
  - every Israel Railways trip of that date, with all its stations across the country;
  - trips of the previous service day that run past midnight (their part after 00:00).

Usage:
  python3 scripts/build_gtfs_data.py [--date YYYY-MM-DD] [--city "תל אביב יפו"] [--name tlv] [--refresh]
  python3 scripts/build_gtfs_data.py --region gushdan --days 2 --out-dir public/data   (the site)

Output: data/<name>_<date>_full.json, or <out-dir>/<name>_<date>.json plus <out-dir>/manifest.json,
in the format GtfsSliceProvider and site/js/engine.js read (see docs/DATA_FORMAT.md).
The zip is kept in data/cache/, which is not part of the project files.
"""
import argparse
import csv
import datetime as dt
import io
import json
import re
import sys
import time
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from zoneinfo import ZoneInfo

GTFS_URL = "https://gtfs.mot.gov.il/gtfsfiles/israel-public-transportation.zip"
ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "data" / "cache" / "israel-public-transportation.zip"
STATIONS = ROOT / "data" / "stations.json"  # underground stations and fixed transfers that the GTFS does not carry

RAIL = "2"
KEEP_TYPES = {"0", "2", "3", "8"}  # light rail, rail, bus, shared taxi; skips cable car and on-demand lines
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
CITY_RE = re.compile(r"עיר:\s*(.*?)\s*רציף:")
B36 = "0123456789abcdefghijklmnopqrstuvwxyz"
REGIONS = {
    # decision 18 in planning/DECISIONS.md; names as they appear after "עיר:" in stops.txt
    "gushdan": ("גוש דן", ["תל אביב יפו", "רמת גן", "גבעתיים", "בני ברק", "חולון", "בת ים", "פתח תקווה", "ראשון לציון",
                          "הרצליה", "רמת השרון", "קרית אונו", "אור יהודה", "יהוד מונוסון", "אזור", "גבעת שמואל",
                          "גני תקווה", "סביון", "כפר שמריהו"]),
}


def b36(n):
    if n < 0:
        raise ValueError(n)
    s = ""
    while True:
        n, r = divmod(n, 36)
        s = B36[r] + s
        if not n:
            return s


def download(refresh):
    if CACHE.exists() and not refresh:
        return
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    part = CACHE.with_suffix(".part")
    print(f"downloading {GTFS_URL}")
    with urllib.request.urlopen(GTFS_URL, timeout=60) as r, open(part, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        while chunk := r.read(1 << 20):
            f.write(chunk)
            got += len(chunk)
            if total and sys.stdout.isatty():
                print(f"\r  {got / 1e6:.0f} / {total / 1e6:.0f} MB", end="", flush=True)
    print()
    if not zipfile.is_zipfile(part):
        part.unlink()
        sys.exit("the download is not a zip file; the server may have returned an error page")
    part.replace(CACHE)


def rows(zf, name):
    with zf.open(name) as raw:
        yield from csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8-sig", newline=""))


def active_services(zf, day):
    """service_ids running on `day`, from calendar.txt plus calendar_dates.txt if the feed has one."""
    ymd, wd = day.strftime("%Y%m%d"), WEEKDAYS[day.weekday()]
    out = {r["service_id"] for r in rows(zf, "calendar.txt") if r[wd] == "1" and r["start_date"] <= ymd <= r["end_date"]}
    if "calendar_dates.txt" in zf.namelist():
        for r in rows(zf, "calendar_dates.txt"):
            if r["date"] == ymd:
                (out.add if r["exception_type"] == "1" else out.discard)(r["service_id"])
    return out


def secs(hms):
    h, m, s = hms.split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def destination(long_name):
    # "origin-city<->destination-city-direction#" -> "destination"
    part = long_name.split("<->")[-1]
    return part.split("-")[0].strip()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--date", default=dt.datetime.now(ZoneInfo("Asia/Jerusalem")).date().isoformat(), help="first date (default: today in Israel)")
    ap.add_argument("--days", type=int, default=1, help="how many days from --date to build")
    ap.add_argument("--city", default="תל אביב יפו")
    ap.add_argument("--region", choices=sorted(REGIONS), help="a set of cities instead of --city")
    ap.add_argument("--name", help="file name prefix (default: tlv, or the region's key)")
    ap.add_argument("--out-dir", help="write <name>_<date>.json files and manifest.json here instead of data/")
    ap.add_argument("--refresh", action="store_true", help="download the GTFS again even if it is cached")
    args = ap.parse_args()
    if args.region:
        label, cities = REGIONS[args.region]
    else:
        label, cities = args.city, [args.city]
    name = args.name or args.region or "tlv"
    out_dir = Path(args.out_dir).resolve() if args.out_dir else None

    download(args.refresh)
    zf = zipfile.ZipFile(CACHE)
    feed_time = dt.datetime(*zf.getinfo("stop_times.txt").date_time)
    cal_end = max(r["end_date"] for r in rows(zf, "calendar.txt"))
    cal_start = min(r["start_date"] for r in rows(zf, "calendar.txt"))
    first = dt.date.fromisoformat(args.date)
    days = [first + dt.timedelta(days=i) for i in range(args.days)]
    days = [d for d in days if cal_start <= d.strftime("%Y%m%d") <= cal_end]
    if not days:
        sys.exit(f"{args.date} is outside the feed's calendar ({cal_start}–{cal_end}); use --refresh or another --date")

    # stops: platforms fold into their parent station, so a station is one stop
    stops_raw = {r["stop_id"]: r for r in rows(zf, "stops.txt")}
    parent = {sid: (r["parent_station"] or sid) for sid, r in stops_raw.items()}
    wanted = set(cities)
    in_city = {sid for sid, r in stops_raw.items() if (m := CITY_RE.search(r["stop_desc"])) and m.group(1) in wanted}
    in_city |= {sid for sid in stops_raw if parent[sid] in in_city}
    found = {m.group(1) for r in stops_raw.values() if (m := CITY_RE.search(r["stop_desc"]))} & wanted
    if wanted - found:
        print("warning: no stops for", ", ".join(sorted(wanted - found)))
    if not in_city:
        sys.exit(f"no stops found for {label}")

    agencies = {r["agency_id"]: r["agency_name"] for r in rows(zf, "agency.txt")}
    routes = {r["route_id"]: r for r in rows(zf, "routes.txt") if r["route_type"] in KEEP_TYPES}
    ctx = dict(zf=zf, feed_time=feed_time, cal=(cal_start, cal_end), stops_raw=stops_raw, parent=parent, in_city=in_city,
               agencies=agencies, routes=routes, label=label, cities=cities)
    written = [build_day(day, ctx, (out_dir / f"{name}_{day.isoformat()}.json") if out_dir else ROOT / "data" / f"{name}_{day.isoformat()}_full.json")
               for day in days]
    if out_dir:
        write_manifest(out_dir, name, label, cities, feed_time, written)


def write_manifest(out_dir, name, label, cities, feed_time, written):
    # every day file present in the folder, not only the ones built now, minus ones that are already over
    today = dt.datetime.now(ZoneInfo("Asia/Jerusalem")).date().isoformat()
    files = sorted(f for f in out_dir.glob(f"{name}_*.json") if f.stem[len(name) + 1:] >= today)
    manifest = {
        "region": label, "cities": cities,
        "generated": dt.datetime.now(ZoneInfo("Asia/Jerusalem")).isoformat(timespec="seconds"),
        "feed": {"url": GTFS_URL, "published": feed_time.isoformat()},
        "days": [{"date": f.stem[len(name) + 1:], "file": f.name, "bytes": f.stat().st_size} for f in files],
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {out_dir / 'manifest.json'}: {', '.join(d['date'] for d in manifest['days'])}")


def build_day(day, ctx, out):
    zf, stops_raw, parent, in_city, routes, agencies = (ctx[k] for k in ("zf", "stops_raw", "parent", "in_city", "routes", "agencies"))
    feed_time, (cal_start, cal_end) = ctx["feed_time"], ctx["cal"]
    prev = day - dt.timedelta(days=1)
    t_start = time.time()

    today_sv, prev_sv = active_services(zf, day), active_services(zf, prev)
    trips = {}  # trip_id -> (route_id, day_offset_minutes, headsign)
    for r in rows(zf, "trips.txt"):
        if r["route_id"] not in routes:
            continue
        if r["service_id"] in today_sv:
            trips[r["trip_id"]] = (r["route_id"], 0, r["trip_headsign"])
        elif r["service_id"] in prev_sv:
            trips[r["trip_id"]] = (r["route_id"], -1440, r["trip_headsign"])
    print(f"{len(trips):,} trips run on {day} or the evening before")

    # stop_times is ~1 GB: read it as plain lines and keep only what we need
    origin = {}  # trip_id -> (first stop_sequence, arrival minute)
    calls = defaultdict(list)  # trip_id -> [(seq, minute, stop_id)]
    with zf.open("stop_times.txt") as raw:
        f = io.TextIOWrapper(raw, encoding="utf-8-sig")
        head = f.readline().strip().split(",")
        i_trip, i_arr, i_stop, i_seq, i_dist = (head.index(k) for k in ("trip_id", "arrival_time", "stop_id", "stop_sequence", "shape_dist_traveled"))
        for n, line in enumerate(f):
            p = line.split(",")
            t = trips.get(p[i_trip])
            if t is None:
                continue
            seq, minute = int(p[i_seq]), round(secs(p[i_arr]) / 60) + t[1]
            o = origin.get(p[i_trip])
            if o is None or seq < o[0]:
                origin[p[i_trip]] = (seq, minute)
            sid = p[i_stop]
            if (routes[t[0]]["route_type"] == RAIL or sid in in_city) and minute >= 0:
                dist = p[i_dist].strip()
                calls[p[i_trip]].append((seq, minute, parent[sid], int(float(dist)) if dist else None))
            if n % 2_000_000 == 0 and sys.stdout.isatty():
                print(f"\r  stop_times: {n / 1e6:.0f}M lines", end="", flush=True)
    print()

    # group trips into patterns: same route, same stops, same running times between them
    stop_ix, stop_list = {}, []
    route_ix, route_list = {}, []
    groups = defaultdict(list)
    shape_dist = {}  # pattern key -> metres from the trip's start to each kept stop (None when the feed has none, as for rail)
    headsigns = defaultdict(Counter)
    for tid, cs in calls.items():
        cs.sort()
        seq_stops, seq_times, seq_dist = [], [], []
        for _, minute, sid, dist in cs:
            if seq_stops and seq_stops[-1] == sid:  # two platforms of one station in a row
                continue
            seq_stops.append(sid)
            seq_times.append(minute)
            seq_dist.append(dist)
        if len(seq_stops) < 2:
            continue
        rid = trips[tid][0]
        if rid not in route_ix:
            route_ix[rid] = len(route_list)
            route_list.append(rid)
        headsigns[rid][trips[tid][2]] += 1
        idx = []
        for sid in seq_stops:
            if sid not in stop_ix:
                stop_ix[sid] = len(stop_list)
                stop_list.append(sid)
            idx.append(stop_ix[sid])
        deltas = tuple(b - a for a, b in zip(seq_times, seq_times[1:]))
        if min(deltas) < 0:
            continue  # broken times in the feed
        offset = seq_times[0] - origin[tid][1]
        key = (route_ix[rid], tuple(idx), deltas, offset)
        groups[key].append(seq_times[0])
        if key not in shape_dist and None not in seq_dist and seq_dist == sorted(seq_dist):
            shape_dist[key] = seq_dist

    rail_stops = {i for (ri, idx, _, _) in groups for i in idx if routes[route_list[ri]]["route_type"] == RAIL}
    out_stops = []
    for i, sid in enumerate(stop_list):
        r = stops_raw[sid]
        code = int(r["stop_code"]) if r["stop_code"].isdigit() else 0
        name = r["stop_name"].strip()
        if i in rail_stops and "רכבת" not in name:
            name = "רכבת " + name
        out_stops.append([code, name, round(float(r["stop_lat"]), 5), round(float(r["stop_lon"]), 5)])

    # minutes between street and platform (5th field) and fixed transfer times, from data/stations.json
    out_transfers = []
    if STATIONS.exists():
        st = json.loads(STATIONS.read_text(encoding="utf-8"))
        by_code = defaultdict(list)
        for i, row in enumerate(out_stops):
            by_code[row[0]].append(i)
        ug = st.get("underground", {})
        for code in ug.get("stops", {}):
            for i in by_code.get(int(code), []):
                out_stops[i].append(ug["minutes"])
        for t in st.get("transfers", []):
            for a in by_code.get(t["from"], []):
                for b in by_code.get(t["to"], []):
                    out_transfers.append([a, b, t["minutes"]])
                    if t.get("both_ways"):
                        out_transfers.append([b, a, t["minutes"]])

    out_routes = []
    for rid in route_list:
        r = routes[rid]
        rail = r["route_type"] == RAIL
        head = destination(r["route_long_name"]) if rail else headsigns[rid].most_common(1)[0][0] or destination(r["route_long_name"])
        out_routes.append([r["route_short_name"] or ("רכבת" if rail else ""), r["route_type"], agencies.get(r["agency_id"], ""), head.replace("_", "/"), rid])

    out_patterns = []
    for key, starts in sorted(groups.items(), key=lambda kv: (kv[0][0], min(kv[1]))):
        ri, idx, deltas, offset = key
        d = "".join(b36(x) for x in deltas) if max(deltas) < 36 else "." + ".".join(b36(x) for x in deltas)
        p = {"r": ri, "s": ".".join(b36(i) for i in idx), "d": d, "t": " ".join(str(t) for t in sorted(starts))}
        if offset:
            p["o"] = offset
        if key in shape_dist:
            p["m"] = ".".join(b36(round(x / 10)) for x in shape_dist[key])
        out_patterns.append(p)

    data = {
        "date": day.isoformat(),
        "window": "00:00-24:00",
        "city": ctx["label"],
        "cities": ctx["cities"],
        "source": f"GTFS של משרד התחבורה (gtfs.mot.gov.il), קובץ מ־{feed_time:%d.%m.%Y %H:%M}",
        "feed": {"url": GTFS_URL, "published": feed_time.isoformat(), "calendar": [cal_start, cal_end]},
        "scope": f"כל הנסיעות של היום בתחנות של {ctx['label']}, ורכבת ישראל בכל הארץ",
        "stops": out_stops,
        "routes": out_routes,
        "patterns": out_patterns,
        "transfers": out_transfers,
    }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    n_trips = sum(len(v) for v in groups.values())
    n_rail = sum(len(v) for k, v in groups.items() if routes[route_list[k[0]]]["route_type"] == RAIL)
    print(f"wrote {out.relative_to(ROOT)} ({out.stat().st_size / 1e6:.1f} MB): {len(out_stops):,} stops, "
          f"{len(out_routes):,} routes, {len(out_patterns):,} patterns, {n_trips:,} trips ({n_rail:,} rail) "
          f"in {time.time() - t_start:.0f}s")
    return out


if __name__ == "__main__":
    main()
