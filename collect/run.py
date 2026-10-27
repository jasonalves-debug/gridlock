"""GRIDLOCK feed entry point (collect/loop.sh runs these).

  python collect/run.py live         every round (5 min): calls, roadwork, digs, 311, 511, TTC alerts, weather
  python collect/run.py static       timetables, cameras, schools, towers, building sites, worship, census
  python collect/run.py static-due   static, but only when the last one is over 20 hours old
"""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))

from gridlock import live, static  # noqa: E402

def static_due():
    import json
    from datetime import datetime, timezone
    from gridlock.common import path
    try:
        g = json.load(open(path("gridlock_static.json")))["generated"]
        age = (datetime.now(timezone.utc) - datetime.fromisoformat(g.replace("Z", "+00:00"))).total_seconds()
    except Exception:  # noqa: BLE001 - missing or unreadable: build it
        age = 1e9
    if age > 20 * 3600:
        print(f"static feed is {age / 3600:.1f} h old: rebuilding")
        static.build()
    else:
        print(f"static feed is {age / 3600:.1f} h old: fine")


if __name__ == "__main__":
    {"live": live.build, "static": static.build, "static-due": static_due}[sys.argv[1] if len(sys.argv) > 1 else "live"]()
