#!/bin/bash
# Upright launcher — double-click this file to start the app.
# It serves the folder on a local port and opens your browser. No terminal use
# needed; just close this window when you're done.

cd "$(dirname "$0")" || exit 1

PORT=8000
# If 8000 is busy, try the next few ports.
for p in 8000 8001 8002 8003; do
  if ! lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1; then PORT=$p; break; fi
done

URL="http://localhost:$PORT"

echo ""
echo "  Upright is starting…"
echo "  → $URL"
echo ""
echo "  Keep this window open while you use the app."
echo "  Tip: pin the browser tab so reminders can fire."
echo "  Close this window to stop Upright."
echo ""

# Open the browser once the server has a moment to come up.
( sleep 1; open "$URL" ) >/dev/null 2>&1 &

if command -v python3 >/dev/null 2>&1; then
  exec python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  exec python -m SimpleHTTPServer "$PORT"
else
  echo "  ⚠ Could not find python3. Install it (https://www.python.org) or run:"
  echo "      npx http-server -p $PORT"
  echo ""
  read -r -p "  Press Return to close."
fi
