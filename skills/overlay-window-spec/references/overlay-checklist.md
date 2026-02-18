# Overlay Checklist

## Baseline First
1. Read `docs/specs/DesktopPetOverlay-실구현-기능-기준서.md` before changing behavior.
2. If behavior changes, update the baseline doc in the same commit.

## Window Flags
1. `transparent: true`
2. `alwaysOnTop: true`
3. `frame: false`
4. `hasShadow: false` (optional but recommended)

## Input Behavior
1. Drag area and clickable area do not conflict.
2. Click-through toggle has clear on/off indicator.
3. Click-through off state is recoverable by user action.

## Stability
1. Verify behavior after app restart.
2. Verify multi-window or multi-character scenario if enabled.
