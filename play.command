#!/bin/bash
# House of Ghouls — one-click launcher (macOS: double-click; Linux: run ./play.command).
# Installs on first run, starts server + client, and opens the game in your browser.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install the LTS version from https://nodejs.org then run this again."
  read -r -p "Press Enter to close." _
  exit 1
fi
node scripts/play.mjs
