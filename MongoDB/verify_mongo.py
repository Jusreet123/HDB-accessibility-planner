import os
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

# Load MongoDB connection string from backend/.env
ENV_PATH = Path(__file__).resolve().parent.parent / "backend" / ".env"
load_dotenv(dotenv_path=ENV_PATH)

db = MongoClient(os.environ["MONGO_URI"])["hdb"]

# ---------- 1. Collection counts ----------
print("== COUNTS ==")
for c in sorted(db.list_collection_names()):
    print(f"{c:20s} {db[c].count_documents({}):>7,}")

# ---------- 2. Anchor point for the geo tests ----------
anchor = db.mrt_exits.find_one({"location": {"$exists": True}})
pt = anchor["location"]
print("\n== ANCHOR ==")
print(anchor.get("station_na"), pt["coordinates"])

# ---------- 3. Amenities within 500 m of the anchor ----------
def count_near(coll, metres):
    return db[coll].count_documents({"location": {"$geoWithin": {
        "$centerSphere": [pt["coordinates"], metres / 6378100.0]}}})

print("\n== WITHIN 500 m ==")
for c in ["childcare_centres", "hawker_centres", "bus_stops", "mrt_exits"]:
    print(f"{c:20s} {count_near(c, 500)}")

# ---------- 4. $geoNear: nearest bus stops (sorted by distance) ----------
print("\n== NEAREST 5 BUS STOPS ==")
for d in db.bus_stops.aggregate([
        {"$geoNear": {"near": pt, "key": "location", "distanceField": "dist_m",
                      "maxDistance": 500, "spherical": True}},
        {"$limit": 5}, {"$project": {"_id": 0, "bus_stop_num": 1, "dist_m": 1}}]):
    print(f"  {d.get('bus_stop_num')}  {d['dist_m']:.0f} m")

# ---------- 5. Coordinate coverage and nearest neighbour per collection ----------
print("\n== COORDINATE COVERAGE ==")
for c in ["childcare_centres", "hawker_centres", "bus_stops", "mrt_exits", "parks", "blocks"]:
    total = db[c].count_documents({})
    located = db[c].count_documents({"location": {"$exists": True}})
    nearest = "no coordinates"
    if located:
        r = list(db[c].aggregate([
            {"$geoNear": {"near": pt, "key": "location", "distanceField": "dist_m", "spherical": True}},
            {"$limit": 1}, {"$project": {"_id": 0, "dist_m": 1}}]))
        nearest = f"{r[0]['dist_m']:.0f} m" if r else "none found"
    print(f"{c:20s} {located:>6,}/{total:<6,} located | nearest to anchor: {nearest}")

# ---------- 6. Parks: polygon geometry and containment ----------
print("\n== PARKS ==")
with_geom = db.parks.count_documents({"geometry": {"$exists": True}})
print("parks with polygon geometry:", with_geom)
print("parks containing the anchor:",
      [p.get("name") for p in db.parks.find({"geometry": {"$geoIntersects": {"$geometry": pt}}}).limit(3)])
tested = hits = 0
for p in db.parks.find({"geometry": {"$exists": True}, "location": {"$exists": True}}).limit(20):
    tested += 1
    hits += db.parks.count_documents({"_id": p["_id"],
                                      "geometry": {"$geoIntersects": {"$geometry": p["location"]}}})
print(f"park centroids inside their own polygon: {hits}/{tested}")