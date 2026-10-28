"""Stage 4: PROVE the relationship types from the data itself (not just from the ERD).

For two entities A and B we count, over all real links in the data:
    max_B_per_A  = the most B's any single A is linked to
    max_A_per_B  = the most A's any single B is linked to

    max_B_per_A  max_A_per_B   ->  relationship
         1            1             1 : 1
        >1            1             1 : M   (one A, many B)
         1           >1             M : 1   (many A, one B)
        >1           >1             M : N   (needs a junction table in SQL)

Output: reports/relationship_report.csv
"""
from pathlib import Path

import pandas as pd


def classify(pairs: pd.DataFrame, a: str, b: str) -> dict:
    pairs = pairs[[a, b]].dropna().drop_duplicates()
    b_per_a = pairs.groupby(a)[b].nunique()
    a_per_b = pairs.groupby(b)[a].nunique()
    many_b, many_a = b_per_a.max() > 1, a_per_b.max() > 1
    kind = {(False, False): "1:1", (True, False): "1:M", (False, True): "M:1", (True, True): "M:N"}[(many_b, many_a)]
    return {"kind": kind, "links": len(pairs),
            "max_B_per_A": int(b_per_a.max()), "avg_B_per_A": round(b_per_a.mean(), 1),
            "max_A_per_B": int(a_per_b.max()), "avg_A_per_B": round(a_per_b.mean(), 1)}


def run(tables: dict, cleaned_dir: Path, reports_dir: Path) -> pd.DataFrame:
    t = tables
    tr, blk, unit = t["resale_transaction"], t["block"], t["block_unit_count"]
    rows = []

    def add(name, a_name, b_name, pairs, a, b, db, expected, implemented_by):
        r = classify(pairs, a, b)
        rows.append({"relationship": name, "A": a_name, "B": b_name, "database": db, **r,
                     "expected": expected, "matches_design": "YES" if r["kind"] == expected else "NO",
                     "implemented_by": implemented_by})

    # ---- relational (MySQL) -------------------------------------------------
    add("Town has Blocks", "town", "block", blk, "town_id", "block_id", "SQL", "1:M",
        "block.town_id FK -> town")
    add("Block has Resale transactions", "block", "resale_transaction", tr, "block_id", "transaction_id", "SQL", "1:M",
        "resale_transaction.block_id FK -> block")
    add("Resale transactions are of a Flat type", "resale_transaction", "flat_type", tr,
        "transaction_id", "flat_type_id", "SQL", "M:1", "resale_transaction.flat_type_id FK -> flat_type")
    add("Resale transactions are of a Flat model", "resale_transaction", "flat_model", tr,
        "transaction_id", "flat_model_id", "SQL", "M:1", "resale_transaction.flat_model_id FK -> flat_model")
    add("Blocks contain Flat types", "block", "flat_type", unit, "block_id", "flat_type_id", "SQL", "M:N",
        "junction table block_unit_count (block_id, flat_type_id, tenure, unit_count)")
    add("Flat types come in Flat models", "flat_type", "flat_model", tr, "flat_type_id", "flat_model_id", "SQL", "M:N",
        "derived through resale_transaction (both FKs on the same row)")

    # ---- document store (MongoDB) -------------------------------------------
    p = cleaned_dir / "mrt_exits.csv"
    if p.exists():
        m = pd.read_csv(p, dtype=str)
        add("MRT station has Exits", "station", "exit", m, "station_na", "objectid", "MongoDB", "1:M",
            "station name repeated on each exit document (or exits embedded in a station document)")
    p = cleaned_dir / "childcare_centres.csv"
    if p.exists():
        c = pd.read_csv(p, dtype=str)
        add("Operator type has Childcare centres", "operator_type", "centre", c, "organisation_code", "centre_key",
            "MongoDB", "1:M", "organisation fields stored on each centre document")

    report = pd.DataFrame(rows)
    reports_dir.mkdir(parents=True, exist_ok=True)
    report.to_csv(reports_dir / "relationship_report.csv", index=False)
    return report
