#!/usr/bin/env sh
# Build, check and serve the site locally (macOS / Linux). Run: ./start.sh
cd "$(dirname "$0")" || exit 1
PY=python3
command -v python3 >/dev/null 2>&1 || PY=python

fail() {
  echo
  echo "Something needs fixing. Read the message above, correct the file it names, then run ./start.sh again."
  exit 1
}

echo "[1/3] Building the timetables from data/raw ..."
$PY scripts/build_data.py || fail
echo
echo "[2/3] Checking alerts.json and overrides.json ..."
$PY scripts/validate_alerts.py || fail
echo
echo "[3/3] Running the tests ..."
$PY -m unittest discover tests || fail

echo
echo "All good. Opening http://localhost:8000 (press Ctrl+C to stop the server)."
URL=http://localhost:8000
( sleep 2; if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi ) >/dev/null 2>&1 &
exec $PY -m http.server 8000 --directory public
