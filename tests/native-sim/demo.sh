#!/bin/bash
# Brings up Called It in a fresh simulator against a local backend with made-up data, for clicking through by hand.
# Everything stays on this Mac: the app only talks to 127.0.0.1, and nothing touches the live deployment.
set -euo pipefail
cd "$(dirname "$0")/../.."
export PATH="/opt/homebrew/bin:$PATH"
[ -d node_modules ] || npm ci --no-audit --no-fund
exec node tests/native-sim/run.mjs --demo "$@"
