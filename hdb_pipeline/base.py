"""Base classes every dataset cleaner inherits from.

How it works (template-method pattern):
    run()  ->  read()  ->  generic steps  ->  extra_steps()  ->  save()

A new dataset only needs a small subclass that sets a few class attributes
and (optionally) overrides extra_steps(). Everything else is inherited.
"""
from pathlib import Path

import pandas as pd

from . import config, io_utils, steps


class DatasetCleaner:
    # ---- settings a subclass can override ----------------------------------
    name = "dataset"            # output file name (no extension)
    patterns: tuple = ()        # file name patterns to look for, e.g. ("HDBPropertyInformation*.csv",)
    required = False            # True = stop with an error if the file is missing
    duplicates = "flag"         # "flag" | "drop" | "off"
    duplicate_subset = None     # columns that define a duplicate (None = all columns)
    fill = None                 # None | "median" | "mean"   (OFF by default: don't invent data)
    skip_type_conversion = ()   # columns convert_types() must leave alone
    # -------------------------------------------------------------------------

    def __init__(self, files: list[Path]):
        self.files = files
        self.report = {"dataset": self.name, "files": len(files)}

    # 1. read --------------------------------------------------------------
    def read(self) -> pd.DataFrame:
        frames = []
        for f in self.files:
            df = io_utils.read_csv_text(f)
            df["source_file"] = f.name
            frames.append(df)
        return pd.concat(frames, ignore_index=True)

    # 2. generic steps (same for every dataset) -----------------------------
    def generic_steps(self, df: pd.DataFrame) -> pd.DataFrame:
        df = df.drop(columns=[c for c in df.columns if c.lower() in config.DROP_METADATA_COLUMNS])
        df = steps.strip_text(df)
        df = steps.mark_missing(df)
        df, empty = steps.drop_empty_columns(df)
        self.report["empty_columns_dropped"] = len(empty)
        df = steps.convert_types(df, skip=self.skip_type_conversion)
        subset = self.duplicate_subset or [c for c in df.columns if c != "source_file"]
        df, n = steps.handle_duplicates(df, self.duplicates, subset)
        self.report["duplicate_mode"] = self.duplicates
        self.report["duplicates_found"] = n
        df, n = steps.fill_numeric(df, self.fill)
        self.report["values_filled"] = n
        return df

    # 3. dataset-specific steps (override in subclasses) --------------------
    def extra_steps(self, df: pd.DataFrame) -> pd.DataFrame:
        return df

    # 4. save ------------------------------------------------------------------
    def save(self, df: pd.DataFrame, out_dir: Path) -> None:
        io_utils.write_csv(df, out_dir / f"{self.name}.csv")

    # the whole thing ------------------------------------------------------------
    def run(self, out_dir: Path) -> pd.DataFrame:
        df = self.read()
        self.report["rows_in"] = len(df)
        df = self.generic_steps(df)
        df = self.extra_steps(df).reset_index(drop=True)
        self.report["rows_out"] = len(df)
        self.save(df, out_dir)
        return df


class GeoDatasetCleaner(DatasetCleaner):
    """For GeoJSON files: adds longitude/latitude, flags points outside SG,
    and saves BOTH a CSV (for SQL) and a GeoJSON (for MongoDB)."""

    key = None                  # column that uniquely identifies a feature (e.g. "objectid")
    skip_type_conversion = ("geometry_json",)

    def read(self) -> pd.DataFrame:
        frames = []
        for f in self.files:
            df = io_utils.read_geojson(f)
            df["source_file"] = f.name
            frames.append(df)
        return pd.concat(frames, ignore_index=True)

    def generic_steps(self, df):
        df = super().generic_steps(df)
        coords = df["geometry_json"].map(_centre)
        df["longitude"] = coords.str[0]
        df["latitude"] = coords.str[1]
        df = steps.flag_outside_sg(df)
        if self.key and self.key in df:
            df[f"{self.key}_is_unique"] = ~df[self.key].duplicated(keep=False)
        return df

    def save(self, df, out_dir):
        io_utils.write_csv(df.drop(columns=["geometry_json"]), out_dir / f"{self.name}.csv")
        io_utils.write_geojson(df.drop(columns=["longitude", "latitude"]),
                               out_dir / f"{self.name}.geojson", self.name)


def _centre(geometry_json: str):
    """Point -> its coordinates. Polygon -> area-weighted centroid of the largest ring
    (more accurate than the middle of the bounding box)."""
    import json
    g = json.loads(geometry_json)
    if g["type"] == "Point":
        return tuple(g["coordinates"][:2])
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    best, best_area = None, -1.0
    for poly in polys:
        ring = poly[0]
        a = cx = cy = 0.0
        for (x0, y0, *_), (x1, y1, *_) in zip(ring, ring[1:]):
            cross = x0 * y1 - x1 * y0
            a += cross
            cx += (x0 + x1) * cross
            cy += (y0 + y1) * cross
        if a and abs(a) > best_area:
            best_area, best = abs(a), (cx / (3 * a), cy / (3 * a))
    if best is None:                                            # degenerate shape: fall back to mean point
        pts = [p for poly in polys for p in poly[0]]
        best = (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))
    return best


class GenericCsvCleaner(DatasetCleaner):
    """Used automatically for any CSV that has no dedicated cleaner."""
    duplicates = "drop"

    def __init__(self, files):
        super().__init__(files)
        self.name = Path(files[0]).stem
        self.report["dataset"] = self.name


class GenericGeoCleaner(GeoDatasetCleaner):
    """Used automatically for any GeoJSON that has no dedicated cleaner."""
    duplicates = "drop"

    def __init__(self, files):
        super().__init__(files)
        self.name = Path(files[0]).stem
        self.report["dataset"] = self.name
