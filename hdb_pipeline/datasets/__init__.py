"""REGISTRY of dataset cleaners.

To add a new dataset:
  1. write a small class (copy one from amenities.py as a template)
  2. add it to the list below
Files that match nothing here are still cleaned with the generic rules.
"""
from .amenities import BusStopCleaner, HawkerCleaner, MrtExitCleaner, ParkCleaner, StreetCoordsCleaner
from .childcare import ChildcareCleaner
from .property import PropertyInfoCleaner
from .resale import ResaleCleaner

REGISTRY = [
    ResaleCleaner,
    PropertyInfoCleaner,
    ChildcareCleaner,
    HawkerCleaner,
    BusStopCleaner,
    MrtExitCleaner,
    ParkCleaner,
    StreetCoordsCleaner,
]
