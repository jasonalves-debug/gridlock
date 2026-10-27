# GRIDLOCK

A live traffic simulation of Scarborough on its real streets. Thousands of simulated cars react to real,
public data: police/fire/EMS calls, Ontario 511 highway events, City roadwork and utility digs, 311 hazards,
TTC alerts/detours and live bus GPS, the TTC timetable, weather, traffic cameras, speed/red-light cameras.

**Play:** download `gridlock.html` and open it in a browser. It fetches fresh data every 2 minutes.

## How it fits together

| Folder | What |
|---|---|
| `gridlock.html` | The game, one self-contained file (built from `game/`). |
| `game/` | Game source. `python game/build.py` rebuilds `gridlock.html`. |
| `collect/` | Data collectors. `collect/loop.sh` runs them every 5 minutes. |
| `.github/workflows/collect.yml` | Runs the collectors around the clock on GitHub Actions. |
| `relay/` | Cloudflare Worker that relays live TTC bus GPS (deployed separately). |
| `data` branch | The collected data the game reads. One commit, replaced every round. |

Needs the repo to be **public** (free Actions minutes, readable data) and the secret `ONTARIO511_KEY`.

| Data | How often |
|---|---|
| Police / fire calls, 511, weather, 311, TTC alerts, digs | every 5 min |
| City roadwork | every 15 min |
| TTC bus GPS (via relay) | every 20 s |
| Timetables, cameras, schools, towers, building sites, census | daily |
