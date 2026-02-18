---
name: overlay-window-spec
description: Implement and verify DesktopPetOverlay window-layer behavior in Electron. Use when working on transparent background, always-on-top, drag movement, click interaction, click-through toggles, multi-monitor overlay stability, and regression checks against the feature baseline document.
---

# Overlay Window Spec

## Workflow
1. Read `../../docs/specs/DesktopPetOverlay-실구현-기능-기준서.md` and `references/overlay-checklist.md` before editing `code/src/main.ts` or renderer interaction code.
2. Apply window options first, then input behavior, then persistence.
3. Run `scripts/check_overlay_flags.sh code/src/main.ts` to verify required options are present.
4. Validate changed behavior against baseline doc and update the baseline doc when behavior changed.
5. Report which overlay behaviors are complete and which remain.

## Required Behaviors
1. Transparent overlay window.
2. Always-on-top behavior.
3. Drag move support without breaking click actions.
4. Click-through toggle path.
5. Last position persistence on restart.

## Implementation Notes
- Keep `BrowserWindow` options centralized in `code/src/main.ts`.
- Guard click-through with explicit toggle state and visible UI feedback.
- Test drag/click/click-through transitions in sequence to catch event conflicts.

## References
- Overlay checklist: `references/overlay-checklist.md`
