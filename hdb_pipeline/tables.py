"""Stage 2: turn the cleaned files into CSVs shaped EXACTLY like the relational tables.

    TOWN 1--* BLOCK 1--* RESALE_TRANSACTION *--1 FLAT_TYPE / FLAT_MODEL
    BLOCK *--* FLAT_TYPE   (through BLOCK_UNIT_COUNT)

Each build_* function makes one table, so a schema change only touches one function.
Load order into the database = the order of TABLE_ORDER below (parents before children).
"""
from pathlib import Path

import pandas as pd

from . import config, io_utils

TABLE_ORDER = ["town", "flat_type", "flat_model", "block", "block_unit_count", "resale_transaction"]

# Property-info count columns -> (flat type name, tenure)
UNIT_COLUMNS = {
    "1room_sold": ("1 ROOM", "SOLD"), "2room_sold": ("2 ROOM", "SOLD"), "3room_sold": ("3 ROOM", "SOLD"),
    "4room_sold": ("4 ROOM", "SOLD"), "5room_sold": ("5 ROOM", "SOLD"), "exec_sold": ("EXECUTIVE", "SOLD"),
    "multigen_sold": ("MULTI-GENERATION", "SOLD"), "studio_apartment_sold": ("STUDIO", "SOLD"),
    "1room_rental": ("1 ROOM", "RENTAL"), "2room_rental": ("2 ROOM", "RENTAL"),
    "3room_rental": ("3 ROOM", "RENTAL"), "other_room_rental": ("OTHER", "RENTAL"),
}


def _with_id(values, id_col, name_col) -> pd.DataFrame:
    df = pd.DataFrame({name_col: sorted(set(values))})
    df.insert(0, id_col, range(1, len(df) + 1))
    return df


def build_town(resale, prop) -> pd.DataFrame:
    """Town names come from resale data; codes (AMK, BD, ...) from property info.
    The code->name link is LEARNED by matching the same block in both files."""
    m = resale[["block", "street_name", "town"]].drop_duplicates().merge(
        prop[["blk_no", "street", "bldg_contract_town"]],
        left_on=["block", "street_name"], right_on=["blk_no", "street"])
    code_map = (m.groupby("bldg_contract_town")["town"].agg(lambda s: s.mode().iat[0]))
    for code, name in config.EXTRA_TOWN_CODES.items():               # manual additions (e.g. Tengah)
        if code in set(prop["bldg_contract_town"]) and code not in code_map:
            code_map[code] = name
    town = _with_id(list(resale["town"].dropna()) + list(code_map.values), "town_id", "town_name")
    name_to_code = {name: code for code, name in code_map.items()}
    town["town_code"] = town["town_name"].map(name_to_code)
    return town, code_map


def build_block(resale, prop, town, code_map, street_coords, geocode) -> pd.DataFrame:
    name_to_id = dict(zip(town["town_name"], town["town_id"]))

    blk = prop.rename(columns={"street": "street_name", "bldg_contract_town": "town_code"}).copy()
    blk["town_id"] = blk["town_code"].map(code_map).map(name_to_id).astype("Int64")
    blk["in_property_info"] = True
    blk = blk.drop(columns=[c for c in UNIT_COLUMNS if c in blk] +
                   [c for c in ("source_file", "dup_count", "is_duplicate") if c in blk])

    # blocks that appear in resale data but not in property info (often demolished / en-bloc)
    known = set(zip(blk["blk_no"], blk["street_name"]))
    extra = (resale[["block", "street_name", "town"]]
             .loc[lambda d: [k not in known for k in zip(d["block"], d["street_name"])]]
             .groupby(["block", "street_name"], as_index=False)["town"].agg(lambda s: s.mode().iat[0])
             .rename(columns={"block": "blk_no"}))
    extra["town_id"] = extra.pop("town").map(name_to_id).astype("Int64")
    extra["in_property_info"] = False
    blk = pd.concat([blk, extra], ignore_index=True)

    # coordinates: block-level geocode if available, else street-level, else empty
    blk["latitude"] = pd.NA
    blk["longitude"] = pd.NA
    blk["coord_source"] = pd.NA
    if geocode is not None and len(geocode):
        g = geocode.dropna(subset=["latitude"]).drop_duplicates(["blk_no", "street_name"]).copy()
        g["postal"] = g["postal"].where(~g["postal"].isin(["NIL", "nil", ""]))   # OneMap writes NIL for "no postal code"
        blk = blk.drop(columns=["latitude", "longitude"]).merge(
            g[["blk_no", "street_name", "latitude", "longitude", "postal"]], how="left",
            on=["blk_no", "street_name"])
        blk.loc[blk["latitude"].notna(), "coord_source"] = "block"
    if street_coords is not None and len(street_coords):
        sc = street_coords.set_index("street_name")
        need = blk["latitude"].isna()
        blk.loc[need, "latitude"] = blk.loc[need, "street_name"].map(sc["street_lat"])
        blk.loc[need, "longitude"] = blk.loc[need, "street_name"].map(sc["street_lon"])
        blk.loc[need & blk["latitude"].notna(), "coord_source"] = "street"

    blk = blk.sort_values(["street_name", "blk_no"]).reset_index(drop=True)
    blk.insert(0, "block_id", range(1, len(blk) + 1))
    first = ["block_id", "blk_no", "street_name", "town_id", "town_code", "in_property_info",
             "latitude", "longitude", "coord_source"]
    return blk[[c for c in first if c in blk] + [c for c in blk.columns if c not in first]]


def build_block_unit_count(prop, block, flat_type) -> pd.DataFrame:
    cols = [c for c in UNIT_COLUMNS if c in prop]
    long = prop.melt(id_vars=["blk_no", "street"], value_vars=cols, var_name="col", value_name="unit_count")
    long = long[long["unit_count"].fillna(0) > 0]                      # zero rows carry no information
    long["flat_type_name"] = long["col"].map(lambda c: UNIT_COLUMNS[c][0])
    long["tenure"] = long["col"].map(lambda c: UNIT_COLUMNS[c][1])
    long = (long.merge(block[["block_id", "blk_no", "street_name"]],
                       left_on=["blk_no", "street"], right_on=["blk_no", "street_name"])
                .merge(flat_type, on="flat_type_name"))
    return long[["block_id", "flat_type_id", "tenure", "unit_count"]].sort_values(["block_id", "flat_type_id"])


def build_resale_transaction(resale, block, flat_type, flat_model) -> pd.DataFrame:
    df = (resale.merge(block[["block_id", "blk_no", "street_name"]],
                       left_on=["block", "street_name"], right_on=["blk_no", "street_name"], how="left")
                .merge(flat_type, left_on="flat_type", right_on="flat_type_name", how="left")
                .merge(flat_model, left_on="flat_model", right_on="model_name", how="left"))
    df.insert(0, "transaction_id", range(1, len(df) + 1))
    df = df.rename(columns={"lease_commence_date": "lease_commence_year"})
    keep = ["transaction_id", "block_id", "flat_type_id", "flat_model_id", "sale_date", "date_basis",
            "storey_range", "storey_min", "storey_max", "floor_area_sqm", "lease_commence_year",
            "remaining_lease_months", "lease_is_estimated", "resale_price", "dup_count", "is_duplicate"]
    return df[[c for c in keep if c in df]]


def build_all(cleaned_dir: Path, tables_dir: Path, geocode_path: Path | None = None,
              street_geocode_path: Path | None = None) -> dict:
    read = lambda n: pd.read_csv(cleaned_dir / f"{n}.csv", dtype={"block": str, "blk_no": str}, low_memory=False)
    resale = read("resale_transactions")
    prop = read("hdb_property_info")
    # street-level fallback: OneMap street lookups first, then hdb_resale_flats.csv if present
    parts = []
    if street_geocode_path and street_geocode_path.exists():
        g = pd.read_csv(street_geocode_path).dropna(subset=["latitude"])
        parts.append(g.rename(columns={"latitude": "street_lat", "longitude": "street_lon"})
                      [["street_name", "street_lat", "street_lon"]])
    if (cleaned_dir / "street_coordinates.csv").exists():
        parts.append(read("street_coordinates")[["street_name", "street_lat", "street_lon"]])
    street = pd.concat(parts).drop_duplicates("street_name") if parts else None
    geocode = (pd.read_csv(geocode_path, dtype={"blk_no": str, "postal": str})
               if geocode_path and geocode_path.exists() else None)

    town, code_map = build_town(resale, prop)
    flat_type = _with_id(list(resale["flat_type"].dropna()) + [v[0] for v in UNIT_COLUMNS.values()],
                         "flat_type_id", "flat_type_name")
    flat_model = _with_id(resale["flat_model"].dropna(), "flat_model_id", "model_name")
    block = build_block(resale, prop, town, code_map, street, geocode)
    unit = build_block_unit_count(prop, block, flat_type)
    trans = build_resale_transaction(resale, block, flat_type, flat_model)

    tables = {"town": town, "flat_type": flat_type, "flat_model": flat_model,
              "block": block, "block_unit_count": unit, "resale_transaction": trans}
    for name in TABLE_ORDER:
        io_utils.write_csv(tables[name], tables_dir / f"{name}.csv")
    return tables
