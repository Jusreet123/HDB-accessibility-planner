"""Listing of childcare / preschool centres.

Fixes:
  * Rows with no centre name/code are NOT junk - they still have a tp_code and an
    address. They are kept and flagged (name_missing). Only rows with no way to
    identify them at all are moved to a separate quarantine file.
  * Vacancy columns keep their text AND get a numeric code (Full=0, Limited=1, Available=2).
  * Postal codes are padded to 6 digits.
  * A single `centre_key` that is always filled (centre_code, else tp_code).
"""
from .. import config, io_utils
from ..base import DatasetCleaner


class ChildcareCleaner(DatasetCleaner):
    name = "childcare_centres"
    patterns = ("ListingofCentres*.csv",)
    duplicates = "flag"

    def extra_steps(self, df):
        if "postal_code" in df:
            df["postal_code"] = df["postal_code"].str.zfill(6)

        df["name_missing"] = df["centre_name"].isna()
        df["centre_key"] = df["centre_code"].fillna(df.get("tp_code"))

        for col in [c for c in df.columns if "vacancy" in c]:
            df[f"{col}_code"] = df[col].map(config.VACANCY_CODES).astype("Int64")

        identifiable = df["centre_key"].notna() | df["centre_address"].notna()
        self.quarantine = df[~identifiable]
        self.report["quarantined"] = len(self.quarantine)
        self.report["name_missing_kept"] = int(df.loc[identifiable, "name_missing"].sum())
        return df[identifiable]

    def save(self, df, out_dir):
        super().save(df, out_dir)
        if len(self.quarantine):
            io_utils.write_csv(self.quarantine, out_dir / f"{self.name}_quarantine.csv")
