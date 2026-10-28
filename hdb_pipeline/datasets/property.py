"""HDB Property Information: one row per block."""
from ..base import DatasetCleaner


class PropertyInfoCleaner(DatasetCleaner):
    name = "hdb_property_info"
    patterns = ("HDBPropertyInformation*.csv",)
    required = True
    duplicates = "flag"
    duplicate_subset = ["blk_no", "street"]          # a block is unique by number + street

    def extra_steps(self, df):
        df["blk_no"] = df["blk_no"].str.upper()
        df["street"] = df["street"].str.upper()
        # Y/N columns -> True/False (easier to store as BOOLEAN)
        yn = [c for c in df.columns
              if df[c].dropna().astype(str).isin(["Y", "N"]).all() and df[c].notna().any()]
        for c in yn:
            df[c] = df[c].map({"Y": True, "N": False})
        return df
