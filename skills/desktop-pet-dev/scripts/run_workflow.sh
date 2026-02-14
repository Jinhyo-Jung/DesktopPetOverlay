#!/usr/bin/env bash
set -euo pipefail

if [[ ! -f package.json ]]; then
  echo "package.json not found. Run from repository root." >&2
  exit 1
fi

npm install
npm run lint

echo "Baseline workflow complete."
