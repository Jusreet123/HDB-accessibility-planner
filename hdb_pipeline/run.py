"""Run the pipeline.

    python -m hdb_pipeline.run --raw "path/to/raw files" --out pipeline_output
    python -m hdb_pipeline.run --raw raw --out out --stages tables,validate     # rerun only some stages
    python -m hdb_pipeline.run --raw raw --out out --stages geocode,tables,validate

Stages:
    clean     raw files      -> out/cleaned/   (one file per dataset; GeoJSON also as .geojson for MongoDB)
    geocode_streets (optional) -> out/street_geocode_cache.csv  (~670 streets, minutes; needs internet)
    geocode   (optional)     -> streets first, then out/block_geocode_cache.csv (hours; resumable)
    geocode_childcare (optional) -> out/childcare_geocode_cache.csv (postal codes; reuses block results
                                    first, then OneMap for the rest, ~15 min) and childcare_centres.geojson
    tables    out/cleaned/   -> out/tables/    (CSV per relational table, ready to load)
    validate  out/tables/    -> out/reports/validation_report.csv

The raw folder is only ever READ. Outputs in --out are regenerated on every run.
"""
import argparse
from pathlib import Path

import pandas as pd

from . import config, io_utils, tables, validate
from .base import GenericCsvCleaner, GenericGeoCleaner
from .datasets import REGISTRY

ALL_STAGES = ["clean", "tables", "validate", "relationships"]


def stage_clean(raw: Path, out: Path) -> dict:
    staging = out / config.STAGING_DIR
    staging.mkdir(parents=True, exist_ok=True)
    io_utils.expand_zips(raw, staging)
    folders = [raw, staging]
    cleaned_dir = out / config.CLEANED_DIR
    reports, claimed = [], set()

    for cls in REGISTRY:
        files = io_utils.find_files(folders, cls.patterns)
        if not files:
            if cls.required:
                raise FileNotFoundError(f"{cls.__name__}: no file matching {cls.patterns}")
            print(f"  (skipped {cls.name}: no matching file)")
            continue
        claimed |= {f.name.lower() for f in files}
        cleaner = cls(files)
        print(f"  cleaning {cleaner.name} from {len(files)} file(s)")
        cleaner.run(cleaned_dir)
        reports.append(cleaner.report)

    # files without a dedicated cleaner: skip (default) or clean with the generic rules
    not_used = []
    for pattern, generic in (("*.csv", GenericCsvCleaner), ("*.geojson", GenericGeoCleaner)):
        for f in io_utils.find_files(folders, (pattern,)):
            if f.name.lower() in claimed:
                continue
            if not config.CLEAN_UNREGISTERED:
                not_used.append({"file": f.name, "reason": "no cleaner in datasets/REGISTRY (not needed by the app)"})
                print(f"  (not used: {f.name})")
                continue
            cleaner = generic([f])
            print(f"  cleaning {cleaner.name} (generic rules)")
            cleaner.run(cleaned_dir)
            reports.append(cleaner.report)
    (out / config.REPORTS_DIR).mkdir(parents=True, exist_ok=True)
    pd.DataFrame(not_used, columns=["file", "reason"]).to_csv(
        out / config.REPORTS_DIR / "datasets_not_used.csv", index=False)

    rep = pd.DataFrame(reports)
    (out / config.REPORTS_DIR).mkdir(parents=True, exist_ok=True)
    rep.to_csv(out / config.REPORTS_DIR / "cleaning_report.csv", index=False)
    print(rep.fillna("").to_string(index=False))
    return {r["dataset"]: r for r in reports}


def run_pipeline(raw, out="pipeline_output", stages=ALL_STAGES):
    """Same as the command line, but callable from a Jupyter notebook:

        from hdb_pipeline.run import run_pipeline
        run_pipeline(r"C:\\Users\\me\\Desktop\\database datasets", "pipeline_output")
    """
    raw, out = Path(raw), Path(out)
    stages = [s.strip() for s in stages.split(",")] if isinstance(stages, str) else list(stages)
    out.mkdir(parents=True, exist_ok=True)
    cleaned_dir, tables_dir = out / config.CLEANED_DIR, out / config.TABLES_DIR
    geocode_path = out / config.GEOCODE_CACHE
    rows_in = None

    needs_cleaned = any(st in stages for st in ("geocode", "geocode_streets", "geocode_childcare", "tables"))
    if needs_cleaned and "clean" not in stages and not (cleaned_dir / "hdb_property_info.csv").exists():
        print(f"(no cleaned files in {cleaned_dir} yet - running the clean stage first)")
        stages = ["clean"] + stages

    if "clean" in stages:
        print("== clean")
        reports = stage_clean(raw, out)
        rows_in = reports.get("resale_transactions", {}).get("rows_in")

    if "geocode" in stages or "geocode_streets" in stages:
        from .geocode import Throttle, geocode_blocks, geocode_streets
        prop = pd.read_csv(cleaned_dir / "hdb_property_info.csv", dtype=str)
        resale = pd.read_csv(cleaned_dir / "resale_transactions.csv", dtype=str, usecols=["block", "street_name"])
        blocks = pd.concat([prop.rename(columns={"street": "street_name"})[["blk_no", "street_name"]],
                            resale.rename(columns={"block": "blk_no"})]).drop_duplicates()
        throttle = Throttle()                       # shared, so the learned pace carries over
        print("== geocode: streets")
        geocode_streets(blocks["street_name"].dropna().unique(), out / config.STREET_GEOCODE_CACHE, throttle)
        if "geocode" in stages:
            print("== geocode: blocks")
            try:
                geocode_blocks(blocks, geocode_path, throttle)
            except KeyboardInterrupt:
                print("Block geocoding paused. Rebuilding tables with what is saved so far ...")

    childcare_cache = out / config.CHILDCARE_GEOCODE_CACHE
    if "geocode_childcare" in stages:
        print("== geocode: childcare postal codes")
        from .geocode import Throttle, geocode_postals
        cc = pd.read_csv(cleaned_dir / "childcare_centres.csv", dtype={"postal_code": str}, usecols=["postal_code"])
        block_cache = pd.read_csv(geocode_path, dtype={"postal": str}) if geocode_path.exists() else None
        if block_cache is None:
            print("  (no block_geocode_cache.csv found - every postal code will be looked up on OneMap)")
        try:
            geocode_postals(cc["postal_code"], childcare_cache, Throttle(), block_cache)
        except KeyboardInterrupt:
            print("Childcare geocoding paused. Saving what is done so far ...")

    # childcare documents for MongoDB (coordinates + nested vacancy); cheap, so rebuilt whenever relevant
    if (cleaned_dir / "childcare_centres.csv").exists() and \
            any(st in stages for st in ("clean", "geocode_childcare", "tables")):
        from . import childcare_geo
        summary = childcare_geo.build(cleaned_dir, childcare_cache)
        print(f"== childcare documents: {summary['located']}/{summary['centres']} centres located "
              f"{summary['by_source']}")

    built = None
    if "tables" in stages:
        print("== tables")
        built = tables.build_all(cleaned_dir, tables_dir, geocode_path, out / config.STREET_GEOCODE_CACHE)
        for name in tables.TABLE_ORDER:
            print(f"  {name:20s} {len(built[name]):>9,} rows")

    report = None
    if "validate" in stages:
        print("== validate")
        if built is None:
            built = {n: pd.read_csv(tables_dir / f"{n}.csv", low_memory=False) for n in tables.TABLE_ORDER}
        if rows_in is None:
            rep = out / config.REPORTS_DIR / "cleaning_report.csv"
            if rep.exists():
                r = pd.read_csv(rep).set_index("dataset")
                rows_in = int(r.loc["resale_transactions", "rows_in"]) if "resale_transactions" in r.index else None
        report = validate.run_checks(built, cleaned_dir, out / config.REPORTS_DIR, rows_in)
        print(report.to_string(index=False))
        fails = (report["status"] == "FAIL").sum()
        print(f"\n{fails} failing check(s)" if fails else "\nAll hard checks passed.")

    if "relationships" in stages:
        print("== relationships")
        from . import relationships
        if built is None:
            built = {n: pd.read_csv(tables_dir / f"{n}.csv", low_memory=False) for n in tables.TABLE_ORDER}
        rel = relationships.run(built, cleaned_dir, out / config.REPORTS_DIR)
        print(rel.to_string(index=False))
    return report


def main():
    ap = argparse.ArgumentParser(description="HDB project data pipeline")
    ap.add_argument("--raw", required=True, type=Path, help="folder with the original downloaded files")
    ap.add_argument("--out", default=Path("pipeline_output"), type=Path, help="output folder")
    ap.add_argument("--stages", default=",".join(ALL_STAGES), help="comma list: clean,geocode_streets,geocode,geocode_childcare,tables,validate,relationships")
    a = ap.parse_args()
    run_pipeline(a.raw, a.out, a.stages)


if __name__ == "__main__":
    main()
