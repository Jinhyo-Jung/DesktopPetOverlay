# CHANGE_LOG

## 2026-02-14T19:28:19+09:00
- `Feed/Clean/Play` 3개 액션을 포함한 상태 관리/저장/오프라인 진행 흐름을 1차 구현했다.
- `src/petState.ts`를 추가해 스탯 감소, 액션 회복, 경고 생성, `schemaVersion` 기반 저장/마이그레이션(`v2`)을 통합했다.
- `index.html`, `src/index.css`, `src/renderer.ts`를 갱신해 4개 스탯 게이지, 액션 버튼, 경고/메타 정보를 UI에 연결했다.
- `source/save-fixtures/legacy-schema-v1.json`, `source/save-fixtures/latest-schema-v2.json` 샘플을 추가하고 `validate_save.py`로 필수 필드 검증을 통과했다.
- `simulate_stats.py`로 2h/4h/8h/12h 감소 시뮬레이션을 실행해 밸런스 기본값을 확인했다.

## 2026-02-14T19:17:26+09:00
- 참고용 문서 확장을 위해 `docs/캐릭터 디자인 전략.md` 내용을 대폭 보강했다.
- 캐릭터 참고 에셋 4종(`source/01_cat*.png`)을 추가했다.
- 이후 질의 응답에서 참조할 수 있도록 관련 자료를 프로젝트 내에 정리했다.

## 2026-02-14T19:14:42+09:00
- `docs/게임 요구사항 문서.md`에 "6단계. 신규 기능 구현 시나리오"를 추가했다.
- Feed/Clean/Play 추가 시 권장 실행 순서를 `desktop-pet-dev -> pet-balance-simulator -> save-migration-guard`로 명시했다.
- 기능 구현, 밸런스 검증, 저장 포맷 안정성 점검을 한 번에 확인하는 기대 결과를 문서에 반영했다.

## 2026-02-14T18:43:38+09:00
- 프로젝트 초기 개발 환경을 WSL 기준으로 구성했다.
- Electron Forge(`vite-typescript`) 템플릿 기반 초기 구조를 루트 디렉터리에 반영했다.
- `src/main.ts`에 오버레이 기본 창 옵션(투명/항상 위/프레임 제거)을 적용했다.
- `index.html`, `src/renderer.ts`, `src/index.css`를 초기 오버레이 UI 형태로 변경했다.
- `docs/개발 환경 구성.md` 문서를 추가해 필요 환경과 실행 방법을 정리했다.

## 2026-02-14T19:02:09+09:00
- 프로젝트 전용 Codex 스킬 6종을 `skills/` 경로에 생성하고 각 `SKILL.md`를 실제 워크플로 지침으로 작성했다.
- 스킬별 실행 스크립트와 참고 문서를 추가했다.
- `agents/openai.yaml`을 스킬별 표시명/설명/기본 프롬프트 기준으로 갱신했다.
- `docs/스킬 사용 가이드.md` 문서를 추가해 간단 사용 방법과 예상 시나리오를 정리했다.
- `quick_validate.py`로 6개 스킬 구조 검증을 완료했다.

## 2026-02-14T19:04:05+09:00
- `docs/캐릭터 디자인 전략.md` 문서를 버전 관리에 추가했다.

## 2026-02-14T19:06:03+09:00
- `docs/스킬 사용 가이드.md` 하단에 `요구사항 문서.md` 개발용 스킬 적용 시나리오를 추가했다.
- 요구사항 문서 작성 흐름을 정책 -> 오버레이 스펙 -> 밸런스 -> 개발 루틴 순서로 제시했다.
