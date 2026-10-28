"""Finding, reading and writing files. The raw folder is only ever READ."""
import json
import zipfile
from pathlib import Path

import pandas as pd


def expand_zips(raw_dir: Path, staging_dir: Path) -> None:
    """Unzip any .zip in the raw folder into the staging folder (raw folder is untouched)."""
    for z in raw_dir.rglob("*.zip"):
        target = staging_dir / z.stem
        if not target.exists():
            with zipfile.ZipFile(z) as zf:
                zf.extractall(target)


def find_files(folders: list[Path], patterns: tuple[str, ...]) -> list[Path]:
    """Files matching any pattern (case-insensitive), searched in all folders, no duplicates by name."""
    found, seen = [], set()
    for folder in folders:
        for p in sorted(folder.rglob("*")):
            if not p.is_file():
                continue
            if any(p.match(pat) or p.name.lower() == pat.lower() or
                   Path(p.name.lower()).match(pat.lower()) for pat in patterns):
                if p.name.lower() not in seen:
                    seen.add(p.name.lower())
                    found.append(p)
    return found


def read_csv_text(path: Path) -> pd.DataFrame:
    """Read every column as text first so IDs keep their exact form."""
    return pd.read_csv(path, dtype=str, keep_default_na=False,
                       encoding="utf-8-sig", encoding_errors="replace")


def read_geojson(path: Path) -> pd.DataFrame:
    """One row per feature: its properties + the geometry stored as a JSON string."""
    with open(path, encoding="utf-8-sig") as f:
        data = json.load(f)
    if not (isinstance(data, dict) and data.get("type") == "FeatureCollection"):
        raise ValueError(f"{path.name} is not a GeoJSON FeatureCollection")
    rows = []
    for ft in data["features"]:
        if not ft.get("geometry"):
            continue                                            # no location = unusable
        props = {k.lower().replace(".", "_"): (v.strip() if isinstance(v, str) else v)
                 for k, v in (ft.get("properties") or {}).items()}
        props["geometry_json"] = json.dumps(ft["geometry"], sort_keys=True)
        rows.append(props)
    return pd.DataFrame(rows)


def write_csv(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, float_format="%.15g")


def write_geojson(df: pd.DataFrame, path: Path, name: str) -> None:
    """Write back as GeoJSON for MongoDB (properties + original shape)."""
    props = df.drop(columns=["geometry_json"])
    records = json.loads(props.to_json(orient="records", double_precision=15))
    features = [{"type": "Feature", "properties": r, "geometry": json.loads(g)}
                for r, g in zip(records, df["geometry_json"])]
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"type": "FeatureCollection", "name": name, "features": features}, f, ensure_ascii=False)
