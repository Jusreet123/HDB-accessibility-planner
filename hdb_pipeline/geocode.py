"""Optional stage: get coordinates from OneMap (Singapore's official map service).

Two levels, run in this order by the `geocode` stage:
  1. STREETS (~670 lookups, a few minutes): one point per street. Every block gets an
     approximate location quickly (coord_source = "street").
  2. BLOCKS (~13,500 lookups, hours): the exact point for each block (coord_source = "block").
     Can be stopped (Ctrl+C) and resumed any time; it carries on where it stopped.

Use stage `geocode_streets` to do only step 1.

Speed is ADAPTIVE: if OneMap says "Too Many Requests" (HTTP 429), the script waits, then
permanently slows its pace (it does NOT go back to full speed and get blocked again).
After a long run of successes it speeds up a little. Current pace is printed with progress.
"""
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import pandas as pd

URL = "https://www.onemap.gov.sg/api/common/elastic/search?searchVal={q}&returnGeom=Y&getAddrDetails=Y&pageNum=1"
COLUMNS = ["blk_no", "street_name", "latitude", "longitude", "postal"]


class Throttle:
    """Keeps requests at a pace OneMap accepts, learned from its 429 replies."""

    def __init__(self, delay=0.5, min_delay=0.3, max_delay=10.0):
        self.delay, self.min_delay, self.max_delay = delay, min_delay, max_delay
        self.ok_streak = 0

    def success(self):
        self.ok_streak += 1
        if self.ok_streak >= 100:                              # long calm stretch -> speed up slightly
            self.delay = max(self.min_delay, self.delay * 0.8)
            self.ok_streak = 0

    def rate_limited(self, retry_after=None):
        """Called on HTTP 429: pause, then slow down for good."""
        self.ok_streak = 0
        self.delay = min(self.max_delay, self.delay * 2)
        pause = retry_after or max(15, self.delay * 10)
        print(f"  OneMap says slow down - pausing {pause:.0f}s, new pace {60 / self.delay:.0f} requests/min")
        time.sleep(pause)

    def wait(self):
        time.sleep(self.delay)

    @property
    def per_minute(self):
        return 60 / self.delay


def _search(query: str):
    req = urllib.request.Request(URL.format(q=urllib.parse.quote(query)),
                                 headers={"User-Agent": "hdb-pipeline (student project)"})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r).get("results", [])


def _lookup(blk_no: str, street: str):
    """Block lookup -> (lat, lon, postal). blk_no=None means street-level lookup."""
    results = _search(f"{blk_no} {street}" if blk_no else street)
    if blk_no:
        for res in results:                                   # prefer an exact block-number match
            if res.get("BLK_NO", "").upper() == blk_no.upper():
                return float(res["LATITUDE"]), float(res["LONGITUDE"]), res.get("POSTAL")
    if results:
        res = results[0]
        return float(res["LATITUDE"]), float(res["LONGITUDE"]), (res.get("POSTAL") if blk_no else None)
    return None, None, None                                   # address genuinely not found


def _lookup_with_retry(blk_no, street, throttle: Throttle, max_tries=6):
    for _ in range(max_tries):
        try:
            return _lookup(blk_no, street)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                ra = e.headers.get("Retry-After") if e.headers else None
                throttle.rate_limited(int(ra) if ra and ra.isdigit() else None)
            elif e.code >= 500:
                print(f"  OneMap server error {e.code} - waiting 10s")
                time.sleep(10)
            else:
                raise                                         # a real error, retrying won't help
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"  network problem ({e}) - waiting 10s")
            time.sleep(10)
    raise RuntimeError("gave up after repeated errors")


def _run(todo: pd.DataFrame, cache: pd.DataFrame, cache_path: Path, label: str,
         throttle: Throttle, save_every: int) -> pd.DataFrame:
    new_rows, failed, start = [], 0, time.time()
    try:
        for i, (blk_no, street) in enumerate(todo.itertuples(index=False), 1):
            try:
                lat, lon, postal = _lookup_with_retry(blk_no, street, throttle)
                new_rows.append({"blk_no": blk_no, "street_name": street,
                                 "latitude": lat, "longitude": lon, "postal": postal})
                throttle.success()
            except Exception as e:                            # not cached -> retried next run
                failed += 1
                print(f"  skipped {blk_no or ''} {street}: {e}")
            if i % save_every == 0 or i == len(todo):
                cache = pd.concat([cache, pd.DataFrame(new_rows, columns=COLUMNS)], ignore_index=True)
                cache.to_csv(cache_path, index=False)
                new_rows = []
                left = (len(todo) - i) * throttle.delay / 60
                print(f"  {label}: {i}/{len(todo)} done | pace {throttle.per_minute:.0f}/min | "
                      f"~{left:.0f} min left")
            throttle.wait()
    except KeyboardInterrupt:
        print("\nstopped by you - saving progress")
        cache = pd.concat([cache, pd.DataFrame(new_rows, columns=COLUMNS)], ignore_index=True)
        cache.to_csv(cache_path, index=False)
        raise
    print(f"  {label}: finished in {(time.time() - start) / 60:.0f} min, {failed} skipped (rerun to retry)")
    return cache


def _load_cache(path: Path) -> pd.DataFrame:
    if path.exists():
        return pd.read_csv(path, dtype={"blk_no": str, "postal": str})
    return pd.DataFrame(columns=COLUMNS)


def geocode_streets(streets, cache_path: Path, throttle: Throttle | None = None) -> pd.DataFrame:
    throttle = throttle or Throttle()
    cache = _load_cache(cache_path)
    todo = pd.DataFrame({"blk_no": None, "street_name": sorted(set(streets) - set(cache["street_name"]))})
    print(f"streets: {len(todo)} to look up ({len(cache)} already cached)")
    if len(todo):
        cache = _run(todo, cache, cache_path, "streets", throttle, save_every=50)
    return cache


def geocode_blocks(blocks: pd.DataFrame, cache_path: Path, throttle: Throttle | None = None) -> pd.DataFrame:
    """blocks needs columns blk_no, street_name."""
    throttle = throttle or Throttle()
    cache = _load_cache(cache_path)
    done = set(zip(cache["blk_no"], cache["street_name"]))
    todo = blocks[["blk_no", "street_name"]].drop_duplicates()
    todo = todo[[k not in done for k in zip(todo["blk_no"], todo["street_name"])]]
    print(f"blocks: {len(todo)} to look up ({len(done)} already cached) - "
          f"about {len(todo) * throttle.delay / 60:.0f} min at the current pace. Ctrl+C to stop, rerun to resume.")
    if len(todo):
        cache = _run(todo, cache, cache_path, "blocks", throttle, save_every=100)
    return cache
