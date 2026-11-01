import os, json
from datetime import datetime, timezone
from pathlib import Path
import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient, GEOSPHERE

try:
    from shapely.geometry import shape, mapping, MultiPolygon
    from shapely.geometry.polygon import orient
    from shapely.validation import make_valid
except ImportError:
    shape = None
    print("!! shapely not installed (pip install shapely), so polygons will not be repaired")

load_dotenv()
db = MongoClient(os.environ["MONGO_URI"])["hdb"]
OUT = Path("pipeline_output")
NOW = datetime.now(timezone.utc)
CHILDCARE_CACHE = OUT / "childcare_geocode_cache.csv"   # created by geocode_childcare.py
ID_WORDS = ("postal", "contact", "phone", "block", "blk", "code", "objectid",
            "unique_id", "bus_stop_num", "bus_roof_num", "crc")

# DESIGN RULE: only geographic, self-contained datasets are loaded from "cleaned".
# Resale, lookups (town/flat_type/flat_model) and block_unit_count stay in MySQL.
AMENITIES = {"childcare_centres": "childcare", "hawker_centres": "hawker",
             "bus_stops": "bus", "mrt_exits": "mrt", "parks": "park"}
FILE_OVERRIDES = {}   # e.g. {"parks": "parks.csv"} if keyword matching is ambiguous


def find_file(coll, word):
    if coll in FILE_OVERRIDES:
        return OUT / "cleaned" / FILE_OVERRIDES[coll]
    hits = [f for f in (OUT / "cleaned").glob("*.csv") if word in f.name.lower()]
    if len(hits) != 1:
        print(f"  !! {coll}: expected 1 file containing '{word}', found {[h.name for h in hits]}")
        return None
    return hits[0]


def read(path):
    header = pd.read_csv(path, nrows=0).columns
    # ID-like columns stay as text, but flags such as objectid_1_is_unique stay boolean
    dtypes = {c: str for c in header
              if any(w in c.lower() for w in ID_WORDS) and not c.lower().endswith("_unique")}
    return pd.read_csv(path, dtype=dtypes)


def to_docs(df):
    docs = []
    for r in json.loads(df.to_json(orient="records")):      # NaN -> null, numpy -> plain Python
        r = {k: v for k, v in r.items() if v is not None}
        lon, lat = r.pop("longitude", None), r.pop("latitude", None)
        if lon is not None and lat is not None and 103.5 <= lon <= 104.2 and 1.1 <= lat <= 1.5:
            r["location"] = {"type": "Point", "coordinates": [lon, lat]}    # longitude first
        for k in [k for k in r if k.lower().startswith("geom")]:
            g = r.pop(k)
            if isinstance(g, str):
                try: g = json.loads(g)
                except ValueError: continue
            if isinstance(g, dict) and "coordinates" in g:
                r["geometry"] = g
        docs.append(r)
    return docs


def load(name, docs, src):
    db[name].drop()
    if docs:
        db[name].insert_many(docs, ordered=False)
        db[name].update_many({}, {"$set": {"_source": src, "_loaded_at": NOW}})
    n = db[name].count_documents({})
    located = db[name].count_documents({"location": {"$exists": True}})
    print(f"{name:20s} {n:>7,} docs, {located:>7,} with location")
    if n and located == 0:
        print(f"  WARNING: {name} has no usable coordinates, so it cannot answer distance queries yet")
    print()


def merge_childcare_coordinates(df):
    """Adds latitude/longitude from the OneMap geocode cache, matched on postal code."""
    if not CHILDCARE_CACHE.exists():
        print("  (no childcare geocode cache yet, so childcare will load without coordinates)")
        return df
    pc = next((c for c in df.columns if "postal" in c.lower()), None)
    if pc is None:
        print("  !! no postal code column found in the childcare file")
        return df
    df = df.drop(columns=[c for c in ("latitude", "longitude") if c in df.columns])
    cache = pd.read_csv(CHILDCARE_CACHE, dtype={"postal": str})
    df[pc] = df[pc].str.strip().str.zfill(6)
    return df.merge(cache, left_on=pc, right_on="postal", how="left").drop(columns=["postal"])


# ---------- park polygon helpers ----------
def strip_z(coords):
    """Drops any altitude value: 2dsphere needs plain [lon, lat] pairs."""
    if coords and isinstance(coords[0], (int, float)):
        return coords[:2]
    return [strip_z(c) for c in coords]


def polygon_parts(g):
    if g.is_empty:
        return []
    if g.geom_type == "Polygon":
        return [g]
    if hasattr(g, "geoms"):
        return [p for part in g.geoms for p in polygon_parts(part)]
    return []


def repair_geometry(gd):
    """Returns (clean GeoJSON dict or None, was_invalid)."""
    if shape is None:
        return gd, False
    g = shape(gd)
    was_invalid = not g.is_valid
    if was_invalid:
        g = make_valid(g)
    parts = []
    for p in polygon_parts(g):
        p = p.simplify(1e-6, preserve_topology=True)        # drops duplicate vertices (about 0.1 m)
        if not p.is_valid:
            p = make_valid(p)
        parts.extend(q for q in polygon_parts(p) if q.area > 0)
    if not parts:
        return None, was_invalid
    parts = [orient(p, 1.0) for p in parts]                  # exterior ring counter-clockwise
    out = parts[0] if len(parts) == 1 else MultiPolygon(parts)
    return json.loads(json.dumps(mapping(out))), was_invalid


def attach_park_polygons():
    """Adds each park's polygon (from cleaned/parks.geojson) to its existing document, matched on objectid_1."""
    path = OUT / "cleaned" / "parks.geojson"
    if not path.exists():
        print("  !! cleaned/parks.geojson not found, so parks have centroids only")
        return
    feats = json.load(open(path, encoding="utf-8"))["features"]
    props0 = feats[0]["properties"]
    print(f"parks.geojson: {len(feats)} features | geometry: {feats[0]['geometry']['type']} | "
          f"properties: {list(props0)[:12]}")
    key = next((k for k in props0 if k.lower() == "objectid_1"), None)
    if key is None:
        print("  !! no objectid_1 property, so polygons were NOT attached. Paste this output to Claude")
        return
    attached = repaired = unusable = 0
    for f in feats:
        g = f.get("geometry")
        if not g or g.get("type") not in ("Polygon", "MultiPolygon"):
            continue
        v = f["properties"][key]
        v = str(int(v)) if isinstance(v, (int, float)) else str(v)
        geom, was_invalid = repair_geometry({"type": g["type"], "coordinates": strip_z(g["coordinates"])})
        if geom is None:
            unusable += 1
            continue
        repaired += was_invalid
        attached += db.parks.update_many({"objectid_1": v}, {"$set": {"geometry": geom}}).modified_count
    print(f"  polygons attached to {attached} park documents "
          f"({repaired} were invalid and repaired, {unusable} unusable)\n")


def build_parks_geometry_index():
    try:
        db.parks.create_index([("geometry", GEOSPHERE)])
        print("parks geometry index: OK")
        return
    except Exception as e:
        print("parks geometry index failed:", str(e)[-300:])        # the reason is at the END of the message
    # find exactly which polygons MongoDB rejects, using a scratch collection
    tmp = db["_geo_test"]
    tmp.drop()
    tmp.create_index([("geometry", GEOSPHERE)])
    bad = []
    for d in db.parks.find({"geometry": {"$exists": True}}, {"objectid_1": 1, "name": 1, "geometry": 1}):
        try:
            tmp.insert_one({"geometry": d["geometry"]})
        except Exception as ex:
            bad.append((d["_id"], d.get("objectid_1"), d.get("name"), str(ex)[-120:]))
    tmp.drop()
    print(f"  {len(bad)} polygons rejected by MongoDB:")
    for b in bad[:10]:
        print("    ", b[1:])
    if bad:
        db.parks.update_many({"_id": {"$in": [b[0] for b in bad]}}, {"$unset": {"geometry": ""}})
        db.parks.create_index([("geometry", GEOSPHERE)])
        print(f"  removed the polygon from {len(bad)} parks (their centroid location is kept), index now built")


# ---------- 1. Amenity collections ----------
for coll, word in AMENITIES.items():
    path = find_file(coll, word)
    if path is None:
        continue
    df = read(path)
    if coll == "childcare_centres":
        df = merge_childcare_coordinates(df)
    print(f"{coll}: {path.name}\n  columns: {list(df.columns)}")
    load(coll, to_docs(df), path.name)

# ---------- 2. Park polygons ----------
attach_park_polygons()

# ---------- 3. Derived, read-only copy of the MySQL master (town_name deliberately denormalized) ----------
town = pd.read_csv(OUT / "tables" / "town.csv")
blk = pd.read_csv(OUT / "tables" / "block.csv", dtype={"blk_no": str}).merge(
    town[["town_id", "town_name"]], on="town_id", how="left")
cols = [c for c in ["block_id", "blk_no", "street_name", "town_id", "town_name",
                    "latitude", "longitude"] if c in blk.columns]
load("blocks", to_docs(blk[cols]), "tables/block.csv + tables/town.csv")

# ---------- 4. Indexes ----------
for coll in [*AMENITIES, "blocks"]:
    db[coll].create_index([("location", GEOSPHERE)])
build_parks_geometry_index()
db.blocks.create_index("town_name")
for coll, field in [("childcare_centres", "centre_key"), ("blocks", "block_id"), ("mrt_exits", "objectid")]:
    try:
        db[coll].create_index(field, unique=True)
    except Exception as e:
        print(f"unique index on {coll}.{field} failed:", str(e)[-150:])
print("done")