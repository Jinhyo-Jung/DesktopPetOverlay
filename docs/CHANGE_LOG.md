# CHANGE_LOG

## 2026-02-14T22:31:27+09:00
- `docs/guides/DesktopPetOverlay 사용 가이드.md`를 추가해 결론 우선 구조로 실행/조작/활동 EXP/문제해결(버튼 미노출 포함) 사용법을 정리했다.
- 버튼이 상태 문구(`상태 양호`) 때문에 숨겨지지 않음을 명시하고, UI가 작게 보일 때 하단 액션 버튼이 가려지는 문제를 줄이기 위해 `src/index.css`에 카드 스크롤(`overflow-y: auto`)과 높이 보정(`height: 100%`, `min-height: 0`)을 적용했다.
- `src/main.ts`에서 기본 창 높이를 상향(`640`, 최소 `560`)해 하단 조작 버튼이 기본 창 크기에서 더 안정적으로 보이도록 조정했다.
- 게임 아이콘 요청에 맞춰 `source/exe_icon3.png` 기반 `source/exe_icon3.ico`를 생성하고 `forge.config.ts`의 `packagerConfig.icon` 및 `MakerSquirrel.setupIcon`에 반영했다.
- 요청한 정리 작업으로 `out/DesktopPetOverlay-fixed-win32-x64`, `out/DesktopPetOverlayNew -win32-x64`를 삭제하고 `out/DesktopPetOverlay-win32-x64` 경로에 Windows 패키지를 재생성했다.
- 검증으로 `npm run lint`, `npm run package -- --platform=win32 --arch=x64`, 실행 스모크 테스트를 수행했으며 결과를 `docs/release/릴리즈 준비 결과.md`에 반영했다.

## 2026-02-14T22:17:53+09:00
- 클릭 통과 복구 단축키 충돌 가능성을 낮추기 위해 기본 단축키를 `Ctrl+Shift+O`에서 `Ctrl+Alt+Shift+O`로 변경했다.
- 저장된 오버레이 창 좌표가 화면 밖으로 벗어난 경우를 방지하도록 `src/main.ts`에 작업영역 기준 위치 보정(clamp) 로직을 추가했다.
- `src/renderer.ts`의 초기 단축키 안내 라벨도 새 조합(`Ctrl+Alt+Shift+O`)으로 일치시켰다.
- 릴리스 검증 중 ESLint가 `build-mingw` 생성물(`compiler_depend.ts`)까지 스캔하던 문제를 해소하기 위해 `.eslintignore`를 추가해 `build-mingw/`, `out/`을 제외했다.
- 기존 `out/DesktopPetOverlay-win32-x64/resources/app.asar` 파일 잠금(`EBUSY`)으로 재패키징이 반복 실패하여, 우회 빌드 산출물을 기반으로 실행 가능한 새 폴더 `out/DesktopPetOverlay-fixed-win32-x64`를 생성했다.
- 새 실행 파일 `out/DesktopPetOverlay-fixed-win32-x64/DesktopPetOverlay.exe`의 기동 스모크 테스트(실행 후 강제 종료)로 기본 실행 가능 상태를 확인했다.

## 2026-02-14T22:00:19+09:00
- 패키징 exe 환경에서 `Ctrl+Shift+O` 복구 실패 시 UI 잠금이 발생하던 구조를 수정해, 단축키 등록 실패 시 클릭 통과 ON 전환 자체를 차단하도록 변경했다.
- `src/main.ts`에 단축키 등록 상태(`shortcutRegistered`)를 추가하고 `globalShortcut.register` 성공 여부를 추적하도록 보강했으며, 등록 실패 상태를 IPC(`overlay:get-state`, `overlay:click-through-changed`)로 렌더러에 전달하도록 확장했다.
- `src/main.ts`에서 앱 시작 순서를 `단축키 등록 -> 윈도우 생성`으로 조정하고, 포커스 시 단축키 재등록을 시도해 패키징 실행 중 등록 상태 변동에도 복구 경로를 유지하도록 했다.
- `src/preload.ts`, `src/renderer.ts`에 `shortcutRegistered` 상태를 연결해 단축키 등록 실패 시 "등록 실패" 안내를 UI에 표시하고 클릭 통과 활성화 거부 이유를 즉시 확인 가능하게 했다.
- 검증으로 `overlay-window-spec`의 `check_overlay_flags.sh`를 실행해 필수 윈도우 플래그를 확인했고, `npm run make`를 재실행해 최신 산출물(`out/make`) 생성을 확인했다.
- 환경 이슈로 WSL에서는 Node 실행이 차단되어(`WSL 1 is not supported`), 릴리스 검증 일부를 Windows 셸 fallback으로 수행했다. `npm run lint`는 `build-mingw/CMakeFiles/OverlayBreathingPreview.dir/compiler_depend.ts` 파싱 오류(기존 생성물 영향)로 실패했다.

## 2026-02-14T21:36:54+09:00
- 문서 폴더 과밀 해소를 위해 `docs`를 카테고리 구조(`requirements`, `design`, `guides`, `policies`, `release`)로 재분류하고 기존 문서를 각 하위 폴더로 이동했다.
- 문서 인덱스 `docs/README.md`를 추가해 카테고리 기준, 현재 문서 맵, 기준 경로를 한눈에 확인할 수 있도록 정리했다.
- `docs/guides/OverlayBreathingPreview 실행 가이드.md`를 신규 작성해 목적, 빌드/실행 방법, 산출물 확장자, 정상 동작 기준, 문제 해결 체크포인트를 명시했다.

## 2026-02-14T21:27:19+09:00
- 빌드 산출물 폴더에서 실행 시 이미지 경로 문제를 방지하기 위해 `CMakeLists.txt`에 POST_BUILD 복사 단계를 추가해 `build-mingw/source/01_cat.png`가 자동 생성되도록 조정했다.
- 이 변경으로 `OverlayBreathingPreview.exe`를 더블클릭 실행해도 `./source/01_cat.png` 경로가 유효하도록 보장했다.

## 2026-02-14T21:26:09+09:00
- `OverlayBreathingPreview.exe`를 `build-mingw` 폴더에서 직접 실행할 때 상대경로(`./source/01_cat.png`) 해석 실패로 즉시 종료되는 문제를 수정했다.
- `src/Main.cpp`에 PNG 경로 자동 탐색 로직(`./source`, `../source`, 실행 파일 기준 경로 후보)을 추가해 실행 위치와 무관하게 `source/01_cat.png`를 찾도록 보강했다.
- 초기화 실패 시 원인을 확인할 수 있도록 단계별 `HRESULT` 오류 메시지(`MessageBoxW`)를 표시하도록 개선했다.

## 2026-02-14T21:23:36+09:00
- Windows 실행 시 `libgcc_s_seh-1.dll` 누락 오류를 해결하기 위해 `CMakeLists.txt`에 MinGW 전용 정적 링크 옵션(`-static`, `-static-libgcc`, `-static-libstdc++`)을 추가했다.
- 재빌드 후 실행 파일의 DLL 의존성을 재검증해 MinGW 런타임 DLL(`libgcc_s_seh-1.dll`, `libstdc++-6.dll`) 의존이 제거되도록 조정했다.

## 2026-02-14T21:22:01+09:00
- WSL에서 `cmake -S . -B build-mingw -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++` 빌드를 시도하던 중 MinGW 링크 단계에서 `WinMain` 엔트리포인트 누락 오류를 확인했다.
- `src/Main.cpp`에 `WinMain` 래퍼를 추가해 기존 `wWinMain` 흐름을 재사용하도록 조정하고 MinGW 교차 컴파일 호환성을 보완했다.

## 2026-02-14T21:07:49+09:00
- `docs/코드 기반 breathing 아이디어.md` 기준으로 Win32 + Direct2D + WIC 호흡 모션 미리보기 구현 코드를 신규 추가해 `source/01_cat.png`를 비변형 상태로 렌더링하면서 Y축 정수 오프셋(±1~2px) 기반 사인파 애니메이션이 가능하도록 구성했다.
- 루트 `CMakeLists.txt`와 `src/Main.cpp`, `src/Renderer.h`, `src/Renderer.cpp`, `src/BreathingMotion.h`를 생성하고 PNG 32bppPBGRA 로드, `DrawBitmap` `NEAREST_NEIGHBOR`, `lround` 기반 오프셋 계산, ComPtr 기반 COM 자원 관리를 반영했다.
- WSL 환경에서 `cmake`/C++ 컴파일러가 설치되어 있지 않아 실제 빌드 실행 검증은 이번 작업에서 수행하지 못했다.

## 2026-02-14T20:13:23+09:00
- `package_windows.sh` 재검증 과정에서 Linux 배포 단계 실행 파일명 불일치 이슈를 수정하기 위해 `forge.config.ts`의 `MakerRpm`/`MakerDeb` `bin` 값을 `DesktopPetOverlay`로 설정했다.
- WSL 환경에서 `bash skills/release-packaging-windows/scripts/package_windows.sh`를 다시 실행해 `npm run make` 성공을 확인했다.
- 신규 산출물 `out/make/deb/x64/desktop-pet-overlay_1.0.0_amd64.deb`, `out/make/rpm/x64/desktop-pet-overlay-1.0.0-1.x86_64.rpm`의 경로/해시를 검증했다.
- 최신 결과를 반영하도록 `docs/릴리즈 준비 결과.md`를 업데이트했다.

## 2026-02-14T19:52:48+09:00
- `release-packaging-windows` 시나리오를 수행해 `npm run lint`와 Windows 타깃 패키징(`npm run package -- --platform=win32 --arch=x64`)을 실행했다.
- 산출물 `out/DesktopPetOverlay-win32-x64/DesktopPetOverlay.exe`와 `resources/app.asar`의 경로/크기/SHA-256을 검증했다.
- `package_windows.sh`는 `rpmbuild` 미설치로 중단되었고, Squirrel 타깃 `make`는 `Mono/Wine` 미설치로 실패해 설치형 패키지는 미생성 상태로 확인했다.
- 릴리즈 상태 정리를 위해 `docs/릴리즈 준비 결과.md` 문서를 추가했다.

## 2026-02-14T19:45:15+09:00
- PC 활동량 기반 EXP 연동을 위해 `src/activityExp.ts`를 추가하고 최소 수집(활성 시간/입력 이벤트 집계), 일일 상한, 수동 체크인 대체 경로를 구현했다.
- `src/renderer.ts`에 활동 EXP 토글/리셋/체크인 UI 동작과 5분 샘플링 환산(`floor(activeMinutes * 0.4 + inputEvents / 140)`) 로직을 연결했다.
- `src/petState.ts`에 EXP 증감 공용 함수(`applyExpDelta`)를 추가해 활동 EXP 리셋 시 누적 활동 EXP 차감이 가능하도록 정리했다.
- `index.html`, `src/index.css`를 갱신해 활동 EXP 제어 패널과 EXP 진행 표시를 추가했다.
- 정책 문서 `docs/PC 활동 EXP 정책.md`를 신설해 개인정보 원칙, 수집 항목, 환산식, 상한, 예외 처리를 결론 우선 형식으로 정리했다.
- `pc-activity-exp-policy` 및 `pet-balance-simulator` 스크립트를 실행해 EXP 환산/기존 스탯 밸런스 결과를 점검했다.

## 2026-02-14T19:38:18+09:00
- 오버레이 고급 기능 1차로 클릭-통과 토글, 단축키 복구 경로(`Ctrl+Shift+O`), 창 위치/토글 상태 영속화를 구현했다.
- `src/main.ts`에 오버레이 IPC(`overlay:get-state`, `overlay:set-click-through`, `overlay:toggle-click-through`)와 글로벌 단축키 처리, 위치 저장 로직을 추가했다.
- `src/preload.ts`에 `overlayBridge`를 노출해 렌더러에서 클릭-통과 상태 조회/변경/구독이 가능하도록 연결했다.
- `index.html`, `src/index.css`, `src/renderer.ts`를 갱신해 클릭-통과 상태 UI와 멀티 캐릭터 추가/삭제/드래그 영역을 추가하고 드래그/클릭 동작을 분리했다.
- `check_overlay_flags.sh` 검증은 통과했으며, `npm run lint`는 WSL 환경에 `npm`이 없어 실행하지 못했다.

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
