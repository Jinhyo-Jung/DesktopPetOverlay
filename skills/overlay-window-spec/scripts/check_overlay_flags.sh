#!/usr/bin/env bash
set -euo pipefail

FILE="${1:-src/main.ts}"

if [[ ! -f "$FILE" ]]; then
  echo "File not found: $FILE" >&2
  exit 1
fi

required=("transparent: true" "alwaysOnTop: true" "frame: false")

for token in "${required[@]}"; do
  if ! grep -Fq "$token" "$FILE"; then
    echo "Missing required option in $FILE: $token" >&2
    exit 1
  fi
done

echo "Overlay flags look good in $FILE"
