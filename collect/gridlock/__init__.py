"""GRIDLOCK data feed: turns public Toronto data into small Scarborough-only JSON files for the GRIDLOCK traffic sim.

live.py    runs every 5 minutes (collect/loop.sh)
static.py  runs daily in its own workflow (big downloads: GTFS, permits, buildings)
"""
