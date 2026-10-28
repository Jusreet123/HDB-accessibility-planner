"""GeoJSON amenity datasets (go to MongoDB, CSV copy for SQL).

Each one is a few lines: which file, what its unique key is, and any extra step.
"""
import pandas as pd

from ..base import DatasetCleaner, GeoDatasetCleaner


class HawkerCleaner(GeoDatasetCleaner):
    name = "hawker_centres"
    patterns = ("HawkerCentres*.geojson",)
    key = "objectid"

    def extra_steps(self, df):
        if "addresspostalcode" in df:
            df["addresspostalcode"] = df["addresspostalcode"].astype("string").str.zfill(6)
        return df


class BusStopCleaner(GeoDatasetCleaner):
    name = "bus_stops"
    patterns = ("LTABusStop*.geojson",)
    key = "bus_stop_num"


class MrtExitCleaner(GeoDatasetCleaner):
    name = "mrt_exits"
    patterns = ("LTAMRTStationExit*.geojson",)
    key = "objectid"                       # station+exit is NOT unique (MRT & LRT share names)

    def extra_steps(self, df):
        df["station_name"] = (df["station_na"].str.replace(r"\s+(MRT|LRT) STATION$", "", regex=True)
                              .str.title())
        df["station_exit_shared"] = df.duplicated(["station_na", "exit_code"], keep=False)
        return df


class ParkCleaner(GeoDatasetCleaner):
    name = "parks"
    patterns = ("NParksParks*.geojson",)
    key = "objectid_1"
    # longitude/latitude here = polygon centroid; use the real shape in MongoDB for distance queries


class StreetCoordsCleaner(DatasetCleaner):
    """Optional: hdb_resale_flats.csv carries street-level lat/lon.
    Only the unique street -> coordinate lookup is kept (fallback location for blocks)."""
    name = "street_coordinates"
    patterns = ("hdb_resale_flats*.csv",)
    duplicates = "off"

    def extra_steps(self, df):
        need = {"street_name", "street_lat", "street_lon"}
        if not need <= set(df.columns):
            return df.iloc[0:0]
        out = (df.dropna(subset=["street_lat", "street_lon"])
                 .groupby("street_name", as_index=False)[["street_lat", "street_lon"]].first())
        out["street_name"] = out["street_name"].str.upper()
        return out
