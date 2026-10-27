#!/usr/bin/env bash
# One GitHub Actions run = about 5.3 hours of rounds, 5 minutes apart. The schedule queues the next run,
# so collection never stops. Data lives on the `data` branch as a single commit that's replaced every round
# (no history piling up). The game reads it from raw.githubusercontent.com/<owner>/gridlock/data/...
set -u
ROUNDS=${ROUNDS:-64} GAP=${GAP:-300}
git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
export GRIDLOCK_DATA="$PWD/data"; mkdir -p data

# restore last round's data and the running state (call history, geocode caches)
if git fetch --quiet --depth 1 origin data 2>/dev/null; then git archive FETCH_HEAD | tar -x -C data; echo "restored $(ls data | wc -l) files"; else echo "no data branch yet: starting fresh"; fi

publish() { # replace the data branch with one commit holding the current files
  local idx; idx=$(mktemp -u); GIT_INDEX_FILE=$idx git --work-tree=data add -A . && \
  tree=$(GIT_INDEX_FILE=$idx git write-tree) && commit=$(git commit-tree "$tree" -m "data $(date -u +%FT%TZ)") && \
  git push --quiet --force origin "$commit:refs/heads/data" && echo "published $(date -u +%T)" || echo "::warning::publish failed"; rm -f "$idx"
}

for round in $(seq 1 "$ROUNDS"); do
  started=$(date +%s); echo "── round $round/$ROUNDS $(date -u +%T)"
  if [ "$round" -eq 1 ] && [ -n "${FORCE_STATIC:-}" ]; then python collect/run.py static || echo "::warning::static feed failed"   # asked for by hand
  else python collect/run.py static-due || echo "::warning::static feed failed"; fi       # daily: timetables, cameras, schools...
  python collect/police_fire.py   || echo "::warning::police/fire failed"            # TPS + TFS calls → incidents.json
  if [ $(( round % 3 )) -eq 1 ]; then python collect/roadwork.py || echo "::warning::roadwork failed"; fi   # City road restrictions, every 15 min
  python collect/run.py live      || echo "::warning::live feed failed"              # → gridlock_live.json
  publish
  if [ "$round" -lt "$ROUNDS" ]; then wait=$(( GAP - ($(date +%s) - started) )); [ "$wait" -gt 0 ] && sleep "$wait"; fi
done
