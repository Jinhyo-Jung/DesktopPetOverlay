#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f package.json ]]; then
  echo "package.json not found. Run from repository root." >&2
  exit 1
fi

npm run make
echo "Packaging complete. Check out/ or make/ directories."
