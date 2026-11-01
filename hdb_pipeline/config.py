"""All settings in ONE place.

Change behaviour here instead of editing the cleaning code.
"""

# Text values that mean "missing" (compared in lowercase, after trimming spaces)
MISSING_TOKENS = ["", "na", "n/a", "nan", "null", "none", "-"]

# Columns whose name contains one of these words are IDENTIFIERS:
# kept as text (so 018956 and 85A survive) and never filled or converted to numbers.
ID_WORDS = ("postal", "contact", "phone", "block", "blk", "code", "objectid",
            "unique_id", "bus_stop_num", "bus_roof_num", "crc")

# Numeric columns containing these words are never filled with an average
# (a made-up year or date would be misleading).
NO_FILL_WORDS = ("year", "date")

# HDB leases are 99 years. Used to ESTIMATE remaining lease where the source has none.
LEASE_YEARS = 99

# Rough bounding box of Singapore (lon_min, lat_min, lon_max, lat_max).
# Points outside it are FLAGGED, not removed.
SG_BBOX = (103.55, 1.13, 104.10, 1.48)

# Town codes that can't be learned from the data (no resale sales yet).
# Codes that CAN be learned (AMK -> ANG MO KIO etc.) are matched automatically.
EXTRA_TOWN_CODES = {"TG": "TENGAH"}

# Childcare vacancy text -> ordered code (keeps the text column too)
VACANCY_CODES = {"Not Applicable": None, "Full": 0, "Limited": 1, "Available": 2}

# Files with NO dedicated cleaner in datasets/REGISTRY:
#   False = not used (listed in reports/datasets_not_used.csv)  <- only the needed datasets are produced
#   True  = cleaned anyway with the generic rules
CLEAN_UNREGISTERED = False

# Source-system bookkeeping columns with no meaning for the app (dropped from every dataset)
DROP_METADATA_COLUMNS = ("inc_crc", "fmel_upd_d")

# Folder names inside the output folder
CLEANED_DIR = "cleaned"
TABLES_DIR = "tables"
REPORTS_DIR = "reports"
STAGING_DIR = "_staging"          # unzipped raw files go here (raw folder stays untouched)
GEOCODE_CACHE = "block_geocode_cache.csv"
STREET_GEOCODE_CACHE = "street_geocode_cache.csv"
CHILDCARE_GEOCODE_CACHE = "childcare_geocode_cache.csv"
