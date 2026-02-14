---
name: pc-activity-exp-policy
description: Define policy and implementation rules for converting PC activity into EXP with privacy constraints. Use when designing activity metrics, sampling intervals, fallback paths, and consent-safe data handling.
---

# Pc Activity Exp Policy

## Workflow
1. Read policy baseline in `references/privacy-policy.md`.
2. Select minimum viable activity signals.
3. Define EXP conversion rules and anti-abuse caps.
4. Provide fallback path when measurement is unavailable.
5. Validate mapping by running `scripts/preview_exp.py`.

## Policy Rules
1. Collect only aggregate counters, not raw keystrokes.
2. Keep local-only storage by default.
3. Expose user-facing opt-out and reset controls.
4. Do not block progression if activity sampling fails.

## Example Command
`python3 scripts/preview_exp.py --active-minutes 45 --input-events 1200`

## References
- Privacy baseline: `references/privacy-policy.md`
