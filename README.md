# HDB Resale & Livability Explorer: data pipeline

This turns the raw data.gov.sg downloads into cleaned files and database-ready tables. Your raw folder is only ever read, never changed.

## Run it

You need `pandas` (`pip install pandas`).

From a terminal in this folder:
```
python -m hdb_pipeline.run --raw "C:\path\to\raw files" --out pipeline_output
```
From Jupyter, with the notebook saved in this folder:
```python
from hdb_pipeline.run import run_pipeline
run_pipeline(r"C:\path\to\raw files", "pipeline_output")
```
The raw folder can contain `ResaleFlatPrices.zip` as it is; it gets unzipped automatically.

To rerun only some stages, e.g. after changing the schema:
```
python -m hdb_pipeline.run --raw raw --out pipeline_output --stages tables,validate
```

## Jupyter

Open `clean_data_walkthrough.ipynb` (in this folder) to see the cleaning step by step, with the data before and after each step and the code behind it. Set `RAW` in the first code cell, then run the cells from top to bottom.

## Stages

| Stage | Reads | Writes |
|---|---|---|
| `clean` | raw files | `cleaned/`: one CSV per dataset, plus `.geojson` for MongoDB |
| `geocode_streets` (optional, needs internet) | cleaned blocks | `street_geocode_cache.csv`: one point per street (~670 lookups, minutes). Every block gets an approximate location. |
| `geocode` (optional, needs internet) | cleaned blocks | Streets first, then `block_geocode_cache.csv`: the exact point and postal code per block (~13,500 lookups, hours). The speed adapts to OneMap's limit, and you can stop with Ctrl+C and resume. |
| `tables` | `cleaned/` | `tables/`: one CSV per relational table |
| `validate` | `tables/` | `reports/validation_report.csv`: PASS, WARN or FAIL per check |
| `relationships` | `tables/`, `cleaned/` | `reports/relationship_report.csv`: proves each 1:M, M:1 and M:N relationship from the data |

Only the datasets the app needs are produced. Any file with no cleaner in `datasets/REGISTRY` is skipped and listed in `reports/datasets_not_used.csv`. To clean those files with the generic rules instead, set `CLEAN_UNREGISTERED = True` in `config.py`.

`reports/cleaning_report.csv` shows the rows in and out, plus the duplicates found, for every dataset.

## Load order (parents before children)

`town` → `flat_type` → `flat_model` → `block` → `block_unit_count` → `resale_transaction`

MongoDB collections come from `cleaned/*.geojson` (hawker centres, bus stops, MRT exits, parks). Childcare goes from `cleaned/childcare_centres.csv`.

## Project layout

```
hdb_pipeline/
  config.py        all settings: missing-value words, lease years, town codes, vacancy codes
  steps.py         generic cleaning steps, reused by every dataset
  base.py          DatasetCleaner / GeoDatasetCleaner base classes
  datasets/        one small class per dataset + REGISTRY list
  tables.py        builds the relational tables (one function per table)
  validate.py      quality checks (one line per check)
  relationships.py relationship-type proof (one line per relationship)
  geocode.py       optional OneMap lookup with cache
  run.py           runs the stages
```

## Common changes

- **Add a new dataset:** copy a class from `datasets/amenities.py`, then set `name`, `patterns` and `key`, and override `extra_steps()` if needed. Add the class to `REGISTRY` in `datasets/__init__.py`.
- **Prove a new relationship:** add one `add(...)` line in `relationships.py`.
- **Change how duplicates or missing values are handled for one dataset:** set `duplicates = "flag" | "drop" | "off"` or `fill = None | "median" | "mean"` on its class.
- **Change the schema:** edit the matching `build_*` function in `tables.py`.
- **Add a quality check:** add one `check(...)` line in `validate.py`.

## Decisions made

- **Duplicates are flagged, not deleted.** The resale data has 1,929 identical-looking rows. They are marked with `dup_count` and `is_duplicate` and kept, because they can be real separate sales.
- **One resale table.** The 5 files are merged, and `date_basis` records whether each row is from the approval-date era (1990–Feb 2012) or the registration-date era (Mar 2012 onward).
- **Remaining lease.** The official value is used where the source has one. Elsewhere it is estimated as 99 years minus the time since the lease started (capped at 99 years), and `lease_is_estimated` says which rows are estimated.
- **Storey range.** The raw text is kept, alongside `storey_min`, `storey_max` and `storey_bucket_size`. The 2012–2014 data uses 5-floor buckets; the rest uses 3-floor buckets.
- **Missing values are not filled by default.** Inventing values would mislead the analysis.
- **Unmatched blocks.** 192 blocks appear only in the resale data; they are probably demolished. They are added to `block` with `in_property_info = False`, so every sale keeps a valid foreign key.
- **Town codes.** The link from code to name (AMK → ANG MO KIO) is learned by matching the same blocks in both files. Codes with no sales yet, such as Tengah, come from `config.EXTRA_TOWN_CODES`.
- **Childcare.** The 67 centres with no name are kept and flagged, because they still have a `tp_code` and an address. `centre_key` is always filled. Vacancy text keeps a numeric code alongside it (Full = 0, Limited = 1, Available = 2).
- **MRT exits.** The station name plus exit code is not unique, because MRT and LRT stations share names. `objectid` is the key instead.
- **Park coordinates.** Each park's longitude and latitude are the polygon centroid. Use the real shape in MongoDB for distance queries.
- **Block coordinates.** These come from the geocode stage where available (`coord_source = "block"`). Otherwise they are street-level, from `hdb_resale_flats.csv` (`coord_source = "street"`).
