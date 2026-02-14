# Workflow

## Checklist
1. Confirm task scope and target files.
2. Implement minimal viable code change.
3. Validate behavior locally.
4. Update `docs/CHANGE_LOG.md` with ISO-8601 timestamp and Korean text.
5. Prepare commit-ready summary with file paths.

## Minimal Verification Matrix
- UI-only change: start app + smoke interaction.
- Main/preload IPC change: start app + interaction path.
- Packaging change: `npm run make`.
