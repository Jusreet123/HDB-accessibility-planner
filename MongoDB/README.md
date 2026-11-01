# MongoDB part

Loads the geographic datasets into MongoDB Atlas (database `hdb`).

## Setup
1. `python -m pip install -r MongoDB/requirements.txt`
2. Copy `.env.example` to `.env` (in this folder) and put in the real connection string.
   Ask the MongoDB owner for it. Never commit `.env`.

## Run (from the repo root)
1. `python MongoDB/test_mongo.py`    - connection test, expect {'ok': 1.0}
2. `python MongoDB/load_mongo.py`    - rebuilds the six collections from pipeline_output
3. `python MongoDB/check_mongo.py`   - compares MongoDB to the cleaned files and the design rules
4. `python MongoDB/verify_mongo.py`  - runs geo queries ($geoNear, $geoWithin, $geoIntersects)

Collections: childcare_centres, hawker_centres, bus_stops, mrt_exits, parks, blocks.
Resale and lookup tables stay in MySQL by design.