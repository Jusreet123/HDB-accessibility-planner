import os
from pathlib import Path
import pandas as pd
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()
db = MongoClient(os.environ["MONGO_URI"])["hdb"]
OUT = Path("pipeline_output")
AMENITIES = {"childcare_centres": "childcare", "hawker_centres": "hawker",
             "bus_stops": "bus", "mrt_exits": "mrt", "parks": "park"}
FORBIDDEN = {"resale_transaction", "town", "flat_type", "flat_model", "block", "block_unit_count"}
ALLOWED = {*AMENITIES, "blocks", "block_notes"}

present = set(db.list_collection_names())
print("collections:", sorted(present))
print("FORBIDDEN present:", sorted(present & FORBIDDEN) or "none (good)")
print("unexpected extras:", sorted(present - ALLOWED - FORBIDDEN) or "none")
print("missing:", sorted(ALLOWED - present - {"block_notes"}) or "none")
print()

for coll, word in AMENITIES.items():
    f = [x for x in (OUT / "cleaned").glob("*.csv") if word in x.name.lower()]
    csv_rows = len(pd.read_csv(f[0])) if len(f) == 1 else None
    n = db[coll].count_documents({})
    located = db[coll].count_documents({"location": {"$exists": True}})
    bad = sum(1 for d in db[coll].find({"location": {"$exists": True}}, {"location": 1})
              if not (103.5 <= d["location"]["coordinates"][0] <= 104.2
                      and 1.1 <= d["location"]["coordinates"][1] <= 1.5))
    has_idx = "location_2dsphere" in db[coll].index_information()
    ok = n == csv_rows and bad == 0 and has_idx
    print(f"{'OK   ' if ok else 'CHECK'} {coll:18s} mongo={n:>6,} csv={csv_rows} located={located:>6,} "
          f"bad_coords={bad} 2dsphere={has_idx} sources={db[coll].distinct('_source')}")
print("parks with polygon geometry:", db.parks.count_documents({"geometry": {"$exists": True}}))

blk_rows = len(pd.read_csv(OUT / "tables" / "block.csv"))
print(f"\nblocks: mongo={db.blocks.count_documents({}):,} csv={blk_rows:,} "
      f"located={db.blocks.count_documents({'location': {'$exists': True}}):,} "
      f"missing town_name={db.blocks.count_documents({'town_name': {'$exists': False}})}")
print("sample block:", db.blocks.find_one({}, {"_id": 0}))