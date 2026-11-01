"""Attach coordinates to childcare centres and shape them as MongoDB documents.

Input : cleaned/childcare_centres.csv  (flat: 42 vacancy columns etc.)
        childcare_geocode_cache.csv    (postal -> latitude/longitude, from the geocode_childcare stage)
Output: cleaned/childcare_centres.csv      same rows + latitude, longitude, coord_source
        cleaned/childcare_centres.geojson  one NESTED document per centre, for MongoDB:

    {
      "centre_key": "PT8877", "centre_name": "...", "service_model": "CC",
      "organisation": {"code": "PT", "description": "Private Operators"},
      "contact": {"phone": "...", "email": "...", "website": "..."},
      "address": "...", "postal_code": "554360",
      "programme": {"second_languages": ["Chinese", "Malay"], "food_offered": "...",
                    "spark_certified": true, "provides_transport": false, "scheme_type": "...",
                    "weekday_hours": {"open": "07:00", "close": "19:00"}, "saturday_hours": null, ...},
      "vacancy": {"infant": {"current_month": {"status": "Full", "code": 0}, "next_month": {...}, ...},
                  "pg": {...}, "n1": {...}, "n2": {...}, "k1": {...}, "k2": {...}},
      "vacancy_as_of": "2026-09-22",
      "coord_source": "hdb_block" | "onemap" | null
    }
  geometry = GeoJSON Point, or null when the centre could not be located (no postal code / not found).

Example MongoDB query this enables ("near a flat AND infant place available this month"):
    db.childcare_centres.find({
        location: {$near: {$geometry: {type: "Point", coordinates: [lon, lat]}, $maxDistance: 1000}},
        "vacancy.infant.current_month.code": {$gte: 1}
    })
"""
import json
from pathlib import Path

import pandas as pd

from . import config

AGE_GROUPS = ["infant", "pg", "n1", "n2", "k1", "k2"]          # playgroup, nursery 1-2, kindergarten 1-2
MONTHS = ["current_month", "next_month", "third_month", "fourth_month",
          "fifth_month", "sixth_month", "seventh_month"]


def _clean(v):
    """pandas missing -> None (becomes JSON null); numpy numbers -> plain Python."""
    if v is None:
        return None
    try:
        if pd.isna(v):                                            # NaN, pd.NA, NaT
            return None
    except (TypeError, ValueError):
        pass
    if hasattr(v, "item"):
        return v.item()
    return v


def _bool(v):
    v = _clean(v)
    if isinstance(v, str):
        return {"true": True, "false": False}.get(v.lower())
    return bool(v) if v is not None else None


def _yes_no(v):
    return {"Yes": True, "No": False}.get(v) if isinstance(v, str) else None


def _hours(v):
    if isinstance(v, str) and "-" in v:
        open_, close = v.split("-", 1)
        return {"open": open_.strip(), "close": close.strip()}
    return None


def _drop_empty(d: dict) -> dict:
    """MongoDB style: leave a field out instead of storing null (keeps documents small)."""
    return {k: v for k, v in d.items() if v not in (None, {}, [])}


def _document(r: pd.Series) -> dict:
    vacancy = {}
    for g in AGE_GROUPS:
        months = {}
        for m in MONTHS:
            status = _clean(r.get(f"{g}_vacancy_{m}"))
            if status is None:
                continue
            code = config.VACANCY_CODES.get(status)
            months[m] = _drop_empty({"status": status, "code": code})
        if months:
            vacancy[g] = months
    langs = r.get("second_languages_offered")
    doc = {
        "centre_key": _clean(r.get("centre_key")),
        "centre_code": _clean(r.get("centre_code")),
        "tp_code": _clean(r.get("tp_code")),
        "centre_name": _clean(r.get("centre_name")),
        "name_missing": _bool(r.get("name_missing")) or None,          # only stored when True
        "service_model": _clean(r.get("service_model")),
        "organisation": _drop_empty({"code": _clean(r.get("organisation_code")),
                                     "description": _clean(r.get("organisation_description"))}),
        "contact": _drop_empty({"phone": _clean(r.get("centre_contact_no")),
                                "email": _clean(r.get("centre_email_address")),
                                "website": _clean(r.get("centre_website"))}),
        "address": _clean(r.get("centre_address")),
        "postal_code": _clean(r.get("postal_code")),
        "programme": _drop_empty({
            "second_languages": [x.strip() for x in langs.split("|")] if isinstance(langs, str) else None,
            "food_offered": _clean(r.get("food_offered")),
            "spark_certified": _yes_no(r.get("spark_certified")),
            "provides_transport": _yes_no(r.get("provision_of_transport")),
            "government_subsidy": _yes_no(r.get("government_subsidy")),
            "extended_hours": _yes_no(r.get("extended_operating_hours")),
            "gst_registered": _yes_no(r.get("gst_regisration")),          # (sic) source spelling
            "scheme_type": _clean(r.get("scheme_type")),
            "weekday_hours": _hours(r.get("weekday_full_day")),
            "saturday_hours": _hours(r.get("saturday")),
        }),
        "vacancy": vacancy,
        "vacancy_as_of": _clean(r.get("last_updated")),
        "coord_source": _clean(r.get("coord_source")),
    }
    return _drop_empty(doc)


def build(cleaned_dir: Path, cache_path: Path) -> dict:
    """Write the enriched CSV + nested GeoJSON. Returns a small summary dict."""
    src = cleaned_dir / "childcare_centres.csv"
    if not src.exists():
        raise FileNotFoundError(f"{src} not found - run the clean stage first")
    df = pd.read_csv(src, dtype={"postal_code": str, "centre_code": str, "tp_code": str,
                                 "centre_contact_no": str}, low_memory=False)
    for col in ("latitude", "longitude", "coord_source"):               # make reruns idempotent
        if col in df:
            df = df.drop(columns=col)

    if cache_path.exists():
        cache = (pd.read_csv(cache_path, dtype={"postal": str})
                   .dropna(subset=["latitude"]).drop_duplicates("postal"))
        df = df.merge(cache.rename(columns={"postal": "postal_code", "source": "coord_source"}),
                      on="postal_code", how="left")
    else:
        df["latitude"] = df["longitude"] = df["coord_source"] = pd.NA

    df.to_csv(src, index=False, float_format="%.15g")

    features = []
    for _, r in df.iterrows():
        lat, lon = _clean(r["latitude"]), _clean(r["longitude"])
        geometry = {"type": "Point", "coordinates": [lon, lat]} if lat is not None else None
        features.append({"type": "Feature", "geometry": geometry, "properties": _document(r)})
    out = cleaned_dir / "childcare_centres.geojson"
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "name": "childcare_centres", "features": features},
                  f, ensure_ascii=False)

    located = int(df["latitude"].notna().sum())
    return {"centres": len(df), "located": located, "not_located": len(df) - located,
            "by_source": df["coord_source"].value_counts(dropna=False).to_dict()}
