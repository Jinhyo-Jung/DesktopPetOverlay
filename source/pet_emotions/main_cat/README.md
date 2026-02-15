# main_cat Emotion Asset Layout

Conclusion: stage-separated folders are now the standard, and the current runtime sprite set uses `adult/`.

## Directories
- `source/pet_emotions/main_cat/egg/`: egg-stage assets
- `source/pet_emotions/main_cat/baby/`: baby-stage assets
- `source/pet_emotions/main_cat/teen/`: teen-stage assets
- `source/pet_emotions/main_cat/adult/`: adult-stage assets (currently used)

## Naming Convention
- Base emotion files: `neutral.png`, `happy.png`, `sleep.png`, `tired.png`, `dirty.png`
- Variants: `happy_01.png`, `happy_02.png`, `neutral_01.png`, etc.

## Current Runtime Mapping
- `source/pet_sprites/main_cat.json` currently points to `source/pet_emotions/main_cat/adult/*`.
