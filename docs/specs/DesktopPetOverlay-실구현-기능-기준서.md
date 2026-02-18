# DesktopPetOverlay 실구현 기능 기준서

## 결론
이 문서는 현재 저장소 코드 기준으로 `DesktopPetOverlay.exe`가 제공하는 기능을 확정하는 기준 문서다. 이후 기능 추가/수정/삭제 요청 시 에이전트는 이 문서를 먼저 확인하고, 변경 후 본 문서의 회귀 체크를 수행해야 한다.

## 범위
- 기준 코드: `code/src/main.ts`, `code/src/preload.ts`, `code/src/renderer.ts`, `code/src/petState.ts`, `code/src/activityExp.ts`, `index.html`
- 기준 목적: 사용자 확인용 기능 목록 + 에이전트 검증 기준

## 확정 기능 명세
### 1) 오버레이 창/입력 계층
- Electron 창은 투명 배경(`transparent: true`), 항상 위(`alwaysOnTop: true`), 프레임 없음(`frame: false`)으로 생성된다.
- 창은 시작 시 현재 대상 모니터의 작업영역(workArea) 전체 크기로 맞춰진다.
- 클릭 통과(click-through)는 UI 버튼 또는 단축키 `Ctrl+Alt+Shift+O`로 토글된다.
- 클릭 통과 활성 시 입력 무시(`setIgnoreMouseEvents`)가 적용되고, 단축키로 복구할 수 있다.
- 포인터 캡처는 캐릭터/패널 hover 및 드래그 상태에 따라 동적으로 켜지고 꺼진다.
- `overlay:move-window-by` IPC는 하위 호환용으로 남아 있으나 현재 no-op이다.

### 2) 멀티 모니터 동작
- UI 설정에서 모니터 목록을 조회해 대상 모니터를 선택할 수 있다.
- 모니터 적용 시 창 bounds를 대상 workArea로 이동/리사이즈한다.

### 3) 메인 캐릭터/보조 캐릭터 표시 및 모션
- 메인 캐릭터는 성장 단계별(`Egg`, `Baby`, `Teen`, `Adult`)로 표정/스프라이트가 반영된다.
- 스프라이트 JSON(`source/pet_sprites/main_cat.json`) 기반으로 상태별 프레임(`idle/walk/jump/fall/drag`) 재생이 된다.
- 단계 폴더에서 변형 이미지(`*_01`, `*_02`, ...)가 누락되면 같은 단계의 기본 감정 이미지(`happy`, `neutral`, `sleep`, `tired`, `dirty`)로 자동 대체된다.
- PNG 알파값 기반 hit-test로 투명 영역 클릭은 무시된다.
- 메인 캐릭터는 랜덤 이동 모드/현재 위치 고정 모드를 전환할 수 있다.
- 드래그 종료 시 관성(속도) 기반 jump/fall 연출이 적용된다.
- 캐릭터 크기는 1~10단계(최대 x6.00)로 조절되며 위치를 보정한다.
- 보조 캐릭터(add/remove) 로직은 구현되어 있으나 현재 UI 버튼이 비활성화(`disabled = true`)되어 기본 화면에서 조작할 수 없다.

### 4) UI 패널 동작
- 메인 캐릭터 클릭으로 메인 UI 패널 표시/숨김을 토글한다.
- 패널 상단 드래그 핸들로 패널 위치를 이동할 수 있고, 뷰포트 경계 내로 clamp 된다.
- `ESC` 키로 열린 패널을 닫을 수 있다.
- 도움말 패널에서 동작 규칙 요약을 확인할 수 있다.

### 5) 육성/스탯/성장
- 스탯: `hunger`, `happiness`, `cleanliness`, `health` (0~100 clamp)
- Tick: 1분 주기로 스탯 감소(`runTick`)가 적용된다.
- Feed/Clean/Play 액션은 실제 수치 변화가 있을 때만 적용되고 EXP를 부여한다.
- 청결도(`cleanliness`)가 60 이하이면 메인 캐릭터 감정 프레임은 `dirty*` 계열을 우선 사용한다.
- EXP 임계값 기준 성장 단계:
- `Egg` < 30, `Baby` >= 30, `Teen` >= 90, `Adult` >= 180
- 경고 문구는 위험 임계치(<=25) 기준으로 생성된다.

### 6) 저장/마이그레이션
- 메인 세이브는 로컬스토리지 키 `desktop-pet-overlay-save`를 사용한다.
- 스키마 버전은 `v2`이며 로드 시 마이그레이션(`migrateSave`) 후 정규화된다.
- 앱 종료(`beforeunload`) 시 상태/캐릭터/활동 스냅샷/패널 위치가 저장된다.

### 7) 활동 EXP
- 자동 획득: 5분 샘플 주기로 활성 시간/입력 이벤트를 점수화해 EXP 부여
- 공식: `floor(activeMinutes * 0.4 + inputEvents / 140)`
- 일일 자동 획득 상한: 36 EXP
- 수동 획득 버튼: 5분 쿨다운마다 +2 EXP
- 활동 EXP ON/OFF 토글 가능
- 날짜 변경(dayKey) 시 일일 카운터 롤오버

### 8) 초기화
- “성장 내용 초기화”는 세이브/활동 EXP 기록을 삭제하고 상태를 초기화한다.

## 검증 기준(요약)
### 필수 수동 점검
- 클릭 통과 ON/OFF 후 캐릭터 드래그/패널 조작 복구 확인
- 모니터 전환 후 캐릭터 렌더링/드래그 정상 동작 확인
- Feed/Clean/Play가 유효할 때만 EXP 증가하는지 확인
- 5분 샘플 또는 수동 EXP 획득 버튼으로 EXP 반영 확인
- 앱 재실행 후 상태/설정/패널 위치 유지 확인

### 정적 점검
- 오버레이 플래그 스크립트: `bash skills/overlay-window-spec/scripts/check_overlay_flags.sh code/src/main.ts`
- 린트(가능 시): `npm run lint`

## 변경 관리 규칙
- 기능을 추가/수정/삭제하면 본 문서를 같은 커밋에서 반드시 갱신한다.
- 문서와 코드가 불일치하면 코드를 기준으로 즉시 문서를 정정한다.
