"""Generic cleaning steps.

Each function takes a DataFrame and returns a DataFrame (plus a count where useful),
so steps can be reused, reordered or switched off per dataset.
"""
import pandas as pd

from . import config


def is_id(col: str) -> bool:
    return any(word in col.lower() for word in config.ID_WORDS)


def is_text(s: pd.Series) -> bool:
    """True for text columns (works on pandas 2 'object' and pandas 3 'str' dtypes)."""
    return s.dtype == object or pd.api.types.is_string_dtype(s)


def _all_str(s: pd.Series) -> bool:
    return pd.api.types.is_string_dtype(s) and s.dropna().map(type).eq(str).all()


def strip_text(df: pd.DataFrame) -> pd.DataFrame:
    """Remove leading/trailing spaces in every text cell (numbers are left alone)."""
    for col in df.columns:
        s = df[col]
        if not is_text(s):
            continue
        if _all_str(s):
            df[col] = s.str.strip()
        else:
            df[col] = s.map(lambda v: v.strip() if isinstance(v, str) else v)
    return df


def mark_missing(df: pd.DataFrame) -> pd.DataFrame:
    """Turn placeholder text ('na', '-', ...) and all-zero IDs ('00000000') into real missing values."""
    tokens = set(config.MISSING_TOKENS)
    for col in df.columns:
        s = df[col]
        if not is_text(s):
            continue
        text = s.map(lambda v: v if isinstance(v, str) else None)
        missing = text.str.lower().isin(tokens).fillna(False).astype(bool)
        if is_id(col):
            missing |= text.str.fullmatch(r"0+").fillna(False).astype(bool)
        df[col] = s.mask(missing)
    return df


def drop_empty_columns(df: pd.DataFrame) -> tuple[pd.DataFrame, list]:
    empty = [c for c in df.columns if df[c].isna().all()]
    return df.drop(columns=empty), empty


def convert_types(df: pd.DataFrame, skip=()) -> pd.DataFrame:
    """dd/mm/yyyy -> yyyy-mm-dd, and numbers stored as text -> numbers (IDs stay text)."""
    for col in df.columns:
        if col in skip or not is_text(df[col]):
            continue
        values = df[col].dropna()
        if values.empty or not values.map(type).eq(str).all():
            continue
        if values.str.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}").all():
            df[col] = pd.to_datetime(df[col], format="%d/%m/%Y").dt.strftime("%Y-%m-%d")
        elif not is_id(col):
            numbers = pd.to_numeric(df[col], errors="coerce")
            if numbers.notna().sum() == values.size:          # every value is a number
                whole = (numbers.dropna() % 1 == 0).all()
                df[col] = numbers.astype("Int64") if whole else numbers
    return df


def handle_duplicates(df: pd.DataFrame, mode: str, subset=None) -> tuple[pd.DataFrame, int]:
    """mode = 'flag' (add columns, keep rows), 'drop' (delete repeats) or 'off'.

    'flag' adds:
      dup_count     how many identical rows exist in the group (1 = unique)
      is_duplicate  True for the 2nd, 3rd ... copy
    """
    if mode == "off":
        return df, 0
    cols = subset or list(df.columns)
    repeats = df.duplicated(subset=cols, keep="first")
    n = int(repeats.sum())
    if mode == "drop":
        return df[~repeats], n
    hashes = pd.util.hash_pandas_object(df[cols], index=False)
    df["dup_count"] = hashes.map(hashes.value_counts()).astype("Int64")
    df["is_duplicate"] = repeats
    return df, n


def fill_numeric(df: pd.DataFrame, how) -> tuple[pd.DataFrame, int]:
    """Fill missing numbers with the median/mean. how=None turns this OFF (the default)."""
    if not how:
        return df, 0
    filled = 0
    for col in df.columns:
        n_missing = int(df[col].isna().sum())
        if (n_missing and pd.api.types.is_numeric_dtype(df[col]) and not is_id(col)
                and not any(w in col.lower() for w in config.NO_FILL_WORDS)):
            value = df[col].median() if how == "median" else df[col].mean()
            df[f"{col}_was_filled"] = df[col].isna()          # keep a trace of what was invented
            df[col] = df[col].fillna(value)
            filled += n_missing
    return df, filled


def flag_outside_sg(df: pd.DataFrame, lon="longitude", lat="latitude") -> pd.DataFrame:
    x0, y0, x1, y1 = config.SG_BBOX
    df["outside_sg"] = ~(df[lon].between(x0, x1) & df[lat].between(y0, y1))
    return df
