# main_cat Emotion Asset Layout

Conclusion: stage-separated folders are now the standard, and the current runtime sprite set uses `teen/`.

## Directories
- `source/pet_emotions/main_cat/egg/`: egg-stage assets
- `source/pet_emotions/main_cat/baby/`: baby-stage assets
- `source/pet_emotions/main_cat/teen/`: teen-stage assets
- `source/pet_emotions/main_cat/adult/`: adult-stage assets
- `adult/`가 비어 있어도 런타임은 `main_cat.json`을 기준으로 `teen/`을 읽고, 단계별(`egg/baby/teen`) 파생 로드를 시도한다.

## Naming Convention
- Base emotion files: `neutral.png`, `happy.png`, `sleep.png`, `tired.png`, `dirty.png`
- Variants: `happy_01.png`, `happy_02.png`, `neutral_01.png`, etc.

## Current Runtime Mapping
- `source/pet_sprites/main_cat.json` currently points to `source/pet_emotions/main_cat/teen/*`.
