"""Resale flat prices: the 5 data.gov.sg files -> ONE table.

Fixes vs the first version:
  * duplicates are FLAGGED (dup_count, is_duplicate), not deleted - identical-looking
    rows can be genuinely different sales of similar flats in the same block.
  * one table with a `date_basis` column instead of two separate tables.
  * raw storey_range text is kept, plus storey_min/max and the bucket size (3 or 5 floors).
  * remaining lease: the official value where it exists, an ESTIMATE everywhere else,
    and a flag saying which one you are looking at.
"""
import re

import pandas as pd

from .. import config
from ..base import DatasetCleaner


class ResaleCleaner(DatasetCleaner):
    name = "resale_transactions"
    patterns = ("Resale*Approval*.csv", "Resale*Registration*.csv")
    required = True
    duplicates = "flag"
    skip_type_conversion = ("month", "storey_range", "remaining_lease")

    def read(self):
        df = super().read()
        df["date_basis"] = df["source_file"].str.lower().map(
            lambda n: "approval" if "approval" in n else "registration")
        return df

    def extra_steps(self, df):
        # --- consistent spellings ------------------------------------------
        df["flat_type"] = (df["flat_type"].str.upper()
                           .str.replace("MULTI GENERATION", "MULTI-GENERATION", regex=False))
        df["flat_model"] = _canonical_case(df["flat_model"])

        # --- dates ------------------------------------------------------------
        df["sale_date"] = pd.to_datetime(df["month"] + "-01", format="%Y-%m-%d")
        df["sale_year"] = df["sale_date"].dt.year
        df["sale_month"] = df["sale_date"].dt.month

        # --- storeys (raw text kept) --------------------------------------------
        st = df["storey_range"].str.extract(r"(\d+)\s+TO\s+(\d+)").astype("Int64")
        df["storey_min"], df["storey_max"] = st[0], st[1]
        df["storey_bucket_size"] = df["storey_max"] - df["storey_min"] + 1

        # --- remaining lease ------------------------------------------------------
        official = (df["remaining_lease"].map(_lease_to_months).astype("Int64")
                    if "remaining_lease" in df else pd.Series(pd.NA, index=df.index, dtype="Int64"))
        months_used = (df["sale_year"] - df["lease_commence_date"].astype("Int64")) * 12 + (df["sale_month"] - 1)
        # sold before the lease officially started -> cap at the full 99 years
        estimate = (config.LEASE_YEARS * 12 - months_used).clip(upper=config.LEASE_YEARS * 12).astype("Int64")
        df["remaining_lease_months"] = official.fillna(estimate)
        df["lease_is_estimated"] = official.isna()

        # sort oldest -> newest; keep a stable column order
        df = df.sort_values(["sale_date", "town", "block"], kind="stable")
        front = ["month", "sale_date", "sale_year", "sale_month", "date_basis", "town", "flat_type",
                 "block", "street_name", "storey_range", "storey_min", "storey_max", "storey_bucket_size",
                 "floor_area_sqm", "flat_model", "lease_commence_date", "remaining_lease",
                 "remaining_lease_months", "lease_is_estimated", "resale_price"]
        front = [c for c in front if c in df]
        return df[front + [c for c in df.columns if c not in front]]

    def save(self, df, out_dir):
        out = df.copy()
        out["sale_date"] = out["sale_date"].dt.strftime("%Y-%m-%d")
        super().save(out, out_dir)


def _lease_to_months(v):
    """'61 years 04 months', '63 years' or '70' -> months."""
    if pd.isna(v):
        return pd.NA
    v = str(v).strip()
    if re.fullmatch(r"\d+(\.0)?", v):
        return int(float(v)) * 12
    m = re.fullmatch(r"(?:(\d+) years?)?\s*(?:(\d+) months?)?", v)
    return int(m.group(1) or 0) * 12 + int(m.group(2) or 0) if m and any(m.groups()) else pd.NA


def _canonical_case(s: pd.Series) -> pd.Series:
    """'IMPROVED' and 'Improved' -> the most common mixed-case spelling."""
    counts = s.dropna().value_counts()
    best = {}
    for value, n in counts.items():
        key = value.lower()
        prefer = value != value.upper()                         # prefer 'Improved' over 'IMPROVED'
        if key not in best or (prefer and not best[key][1]) or (prefer == best[key][1] and n > best[key][2]):
            best[key] = (value, prefer, n)
    return s.map(lambda v: best[v.lower()][0] if isinstance(v, str) else v)
