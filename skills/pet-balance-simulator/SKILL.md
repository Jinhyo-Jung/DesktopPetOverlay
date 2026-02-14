---
name: pet-balance-simulator
description: Simulate and tune stat balance for hunger, happiness, cleanliness, health, care score, and stage pacing. Use when adjusting game constants, evaluating difficulty, or reviewing offline progression impact.
---

# Pet Balance Simulator

## Workflow
1. Read formulas and constraints in `references/balance-model.md`.
2. Collect current constants from source code or design docs.
3. Run `scripts/simulate_stats.py` with candidate values.
4. Compare outcomes against target play window.
5. Propose minimal parameter changes and rerun.

## Decision Rules
1. Keep early-stage failure risk low for new users.
2. Keep meaningful recovery loops through Feed/Clean/Play/Cure.
3. Cap offline penalties to avoid irreversible states.
4. Keep evolution pace readable and predictable.

## Command
`python3 scripts/simulate_stats.py --minutes 240 --tick 5 --hunger-decay 0.8 --happy-decay 0.5 --clean-decay 0.6`

## References
- Balance model: `references/balance-model.md`
