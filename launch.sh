#!/usr/bin/env bash
# Vox Studio launcher: installs dependencies, builds the UI, starts the local
# server and opens http://localhost:3000 in your default browser.
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 18.18+ is required: https://nodejs.org" >&2
  exit 1
fi
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo "Node.js 18.18+ is required (found $(node -v))." >&2
  exit 1
fi

if [ ! -d node_modules ] || [ package.json -nt node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "==> Installing dependencies"
  npm install --no-audit --no-fund
  touch node_modules
fi

echo "==> Building the interface"
npm run build --silent

open_browser() {
  for _ in $(seq 1 60); do
    if curl -fs "$URL/api/settings" >/dev/null 2>&1; then
      case "$(uname -s)" in
        Darwin) open "$URL" ;;
        MINGW* | MSYS* | CYGWIN*) start "$URL" ;;
        *) xdg-open "$URL" >/dev/null 2>&1 || echo "Open $URL in your browser." ;;
      esac
      return
    fi
    sleep 0.5
  done
  echo "Server did not answer at $URL — check the output above." >&2
}

open_browser &
echo "==> Starting Vox Studio on $URL (Ctrl+C to stop)"
PORT="$PORT" exec node server/index.js
