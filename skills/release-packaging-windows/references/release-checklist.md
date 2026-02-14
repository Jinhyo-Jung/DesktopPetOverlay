# Release Checklist

## Pre-build
1. `npm run lint` passes.
2. Required docs are updated.
3. CHANGE_LOG has latest timestamped entry.

## Build
1. Run `npm run make`.
2. Confirm artifact generation in `out/` and/or `make/`.

## Post-build
1. Smoke-run produced executable.
2. Validate overlay interaction basics.
3. Capture final artifact names and paths.
