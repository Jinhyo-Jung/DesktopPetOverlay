---
name: release-packaging-windows
description: Package and validate Windows release artifacts for DesktopPetOverlay. Use when preparing executable builds, running release checks, verifying installer outputs, and documenting deployment readiness.
---

# Release Packaging Windows

## Workflow
1. Confirm build is clean and lint checks pass.
2. Run packaging command from repository root.
3. Verify generated artifacts and basic launch behavior.
4. Record release checklist results.
5. Summarize output file paths and known risks.

## Commands
- Quick package: `scripts/package_windows.sh`
- Manual package: `npm run make`

## Release Gate
1. App starts on target Windows environment.
2. Overlay window behavior remains functional.
3. Save/load and offline progress do not regress.
4. Artifact paths are captured for release notes.

## References
- Checklist: `references/release-checklist.md`
