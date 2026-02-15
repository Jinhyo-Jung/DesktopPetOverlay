# WindowPet 레퍼런스 분석

## 결론
- `WindowPet`은 `Tauri + React + Phaser` 구조로, 전체 화면 투명 오버레이에서 **픽셀 단위 드래그 + 물리 기반 상태 전환**을 결합해 "살아있는 캐릭터" 느낌을 만듭니다.
- 드래그 품질 핵심은 `pixelPerfect` 히트테스트, `dragend` 시 속도 기반 tween, 그리고 `worldbounds` 충돌 복귀 로직입니다.
- 캐릭터 표현은 `png 스프라이트시트 + json 상태 정의` 조합이며, 실행 파일(`.exe`) 안에 리소스를 번들하는 구조입니다.

## 분석 기준
- 저장소: `https://github.com/SeakMengs/WindowPet`
- 확인 시점: `2026-02-15`
- 확인 커밋: `aba8d3a` (로컬 클론 기준)

## 확인한 구현 방식
1. 오버레이/윈도우 구조
- `src-tauri/tauri.conf.json`에서 투명(`transparent`), 항상 위(`alwaysOnTop`), 작업표시줄 숨김(`skipTaskbar`) 윈도우를 사용합니다.
- 게임 캔버스는 `src/PhaserWrapper.tsx`에서 화면 크기(`window.screen.width/height`)에 맞춰 리사이즈됩니다.

2. 캐릭터 드래그
- `src/scenes/Pets.ts`에서 캐릭터를 `.setInteractive({ draggable: true, pixelPerfect: true })`로 등록합니다.
- 드래그 중에는 캐릭터 좌표를 포인터 좌표로 직접 이동하고, `drag` 상태 애니메이션으로 전환합니다.
- 드래그 종료(`dragend`) 시 `pointer.velocity`를 사용해 짧은 관성 tween을 적용해 즉시 멈춤을 피합니다.

3. 살아있는 움직임(행동/물리)
- `Phaser Arcade Physics` 중력/가속/속도(`setVelocity`, `setAcceleration`)를 상태별로 분기합니다.
- `worldbounds` 이벤트에서 바닥/벽/천장 충돌 시 `jump/fall/walk/climb/crawl` 상태를 전환합니다.
- 랜덤 행동(멈춤, 방향 전환, 점프)은 주기적 난수 로직으로 발생시켜 반복 패턴을 줄입니다.

4. 작업표시줄 위 착지 느낌
- `src/scenes/Pets.ts`의 `updatePetAboveTaskbar()`에서 `window.screen.height - window.screen.availHeight`로 작업표시줄 높이를 구해 월드 경계를 조정합니다.
- 결과적으로 캐릭터가 바닥 경계에 닿을 때 작업표시줄 "위쪽 선"에 착지하는 것처럼 보입니다.

5. 캐릭터 에셋 형식
- 기본 표현 단위는 이미지 1장(`png spritesheet`) + 상태 정의(`json`)입니다.
- 상태별 프레임은 `src/scenes/manager.ts`에서 `load.spritesheet`와 상태별 프레임 범위(`start/end` 또는 `spriteLine/frameMax`)로 생성됩니다.

## DesktopPetOverlay 적용 제안
1. 드래그 체감 개선
- 현재 단순 좌표 이동에 `dragend` 관성 tween(짧은 duration, ease-out)을 추가합니다.
- 클릭 경계는 `pixel-perfect` 또는 최소한 스프라이트 알파 마스크 기반으로 좁힙니다.

2. 상태 머신 도입
- `idle/walk/jump/fall/drag` 최소 5상태부터 시작해, 물리 이벤트(경계 충돌/드래그 종료)로 상태 전환합니다.

3. 작업표시줄 착지 연출
- 모니터 작업영역 하단을 "지면"으로 간주하고, 착지 시 1회 `fall -> idle` 전환 애니메이션을 넣습니다.

4. 에셋 파이프라인 정리
- 우리 앱도 `png spritesheet + json 상태맵` 포맷을 표준으로 지정하면 확장 캐릭터 추가가 쉬워집니다.

## DesktopPetOverlay 도입 현황 (2026-02-15)
1. 도입 완료
- 드래그 관성 이동(짧은 감쇠) 도입
- `idle/walk/jump/fall/drag` 상태 전환 도입
- 하단 지면 착지 시 `fall -> idle` 전환 도입
- `png + json` 기본 파이프라인 도입 (`source/pet_sprites/main_cat.json`)
- 상태별 다중 프레임 스프라이트 재생 도입(`idle/walk/jump/fall/drag`)
- 알파 마스크 기반 hit-test를 스프라이트 기반 캐릭터 공통 경로로 일반화

2. 추가 고도화 후보
- 캐릭터 타입별(`main/buddy/커스텀`) 별도 스프라이트 프로필 선택 UI
- 프레임 간 보간(모션 블렌딩)과 착지 효과 사운드 연동
