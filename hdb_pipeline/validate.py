"""Stage 3: automatic quality checks. Each check = one line in reports/validation_report.csv.

Add a check by adding one `check(...)` line.
"""
from pathlib import Path

import pandas as pd

from . import config


def run_checks(tables: dict, cleaned_dir: Path, reports_dir: Path, rows_in_resale: int | None) -> pd.DataFrame:
    results = []

    def check(name, failing_rows, severity="error", note=""):
        n = int(failing_rows)
        results.append({"check": name, "failing_rows": n,
                        "status": "PASS" if n == 0 else ("FAIL" if severity == "error" else "WARN"),
                        "note": note})

    t = tables
    tr, blk = t["resale_transaction"], t["block"]

    # primary keys unique
    for name, pk in [("town", ["town_id"]), ("flat_type", ["flat_type_id"]), ("flat_model", ["flat_model_id"]),
                     ("block", ["block_id"]), ("resale_transaction", ["transaction_id"]),
                     ("block_unit_count", ["block_id", "flat_type_id", "tenure"])]:
        check(f"{name}: primary key unique", t[name].duplicated(pk).sum())
    check("block: (blk_no, street_name) unique", blk.duplicated(["blk_no", "street_name"]).sum())

    # foreign keys resolve
    check("resale -> block", tr["block_id"].isna().sum())
    check("resale -> flat_type", tr["flat_type_id"].isna().sum())
    check("resale -> flat_model", tr["flat_model_id"].isna().sum())
    check("block -> town", blk["town_id"].isna().sum(), "warn", "blocks whose town code could not be mapped")

    # nothing lost
    if rows_in_resale is not None:
        check("resale: every raw row kept", abs(rows_in_resale - len(tr)), note=f"raw={rows_in_resale}, out={len(tr)}")

    # plausible values
    check("resale_price > 0", (tr["resale_price"] <= 0).sum())
    check("floor_area_sqm between 20 and 400", (~tr["floor_area_sqm"].between(20, 400)).sum(), "warn")
    check("remaining lease between 0 and 99 years",
          (~tr["remaining_lease_months"].between(0, config.LEASE_YEARS * 12)).sum(), "warn")
    check("storey_min <= storey_max", (tr["storey_min"] > tr["storey_max"]).sum())

    # informational warnings (expected, but you should know the numbers)
    check("resale rows flagged as possible duplicates", tr["is_duplicate"].sum(), "warn", "kept, not deleted")
    check("resale rows with ESTIMATED lease", tr["lease_is_estimated"].sum(), "warn",
          "source had no remaining_lease for these periods")
    check("blocks only seen in resale data", (~blk["in_property_info"].astype(bool)).sum(), "warn",
          "added as placeholder blocks")
    check("blocks without coordinates", blk["latitude"].isna().sum(), "warn", "run the geocode stage to fill")

    # amenity files
    for name, key in [("hawker_centres", "objectid"), ("bus_stops", "bus_stop_num"),
                      ("mrt_exits", "objectid"), ("parks", "objectid_1")]:
        p = cleaned_dir / f"{name}.csv"
        if p.exists():
            df = pd.read_csv(p, dtype=str)
            check(f"{name}: {key} unique", df[key].duplicated().sum())
            check(f"{name}: inside Singapore", (df["outside_sg"] == "True").sum(), "warn")
    p = cleaned_dir / "childcare_centres.csv"
    if p.exists():
        df = pd.read_csv(p, dtype=str)
        check("childcare: centre_key filled", df["centre_key"].isna().sum())
        pc = df["postal_code"].dropna()
        check("childcare: postal code is 6 digits", (~pc.str.fullmatch(r"\d{6}")).sum())
        check("childcare: postal code missing", df["postal_code"].isna().sum(), "warn", "blank in source")
        check("childcare: name missing (kept, has tp_code)", (df["name_missing"] == "True").sum(), "warn")
        if "latitude" in df:
            check("childcare: centres without coordinates", df["latitude"].isna().sum(), "warn",
                  "no postal code, or postal not found on OneMap; run geocode_childcare if this is all of them")

    report = pd.DataFrame(results)
    reports_dir.mkdir(parents=True, exist_ok=True)
    report.to_csv(reports_dir / "validation_report.csv", index=False)
    return report
