#!/bin/bash
# Run the AOML engine from the workspace root
set -e

WORKSPACE_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
CLI_BIN="$WORKSPACE_ROOT/packages/cli/dist/bin.js"

if [ ! -f "$CLI_BIN" ]; then
  echo "Building AOML engine..."
  cd "$WORKSPACE_ROOT" && pnpm run build
fi

exec node "$CLI_BIN" "$@"
