---
name: save-migration-guard
description: Guard save-data compatibility for DesktopPetOverlay. Use when changing persistence schema, introducing new fields, loading older save files, or implementing migration/versioning logic.
---

# Save Migration Guard

## Workflow
1. Read `references/save-schema.md` and current persistence code.
2. Define schema version bump and migration steps.
3. Implement backward-compatible loader first, then writer.
4. Validate sample saves with `scripts/validate_save.py`.
5. Report migration behavior for missing and legacy fields.

## Rules
1. Never break existing required fields silently.
2. Add defaults for new fields in migration path.
3. Persist `lastSeenTimestamp` and version metadata.
4. Keep migration idempotent and deterministic.

## References
- Save schema: `references/save-schema.md`
