# OverlayBreathingPreview 실행 가이드

## 결론
`OverlayBreathingPreview`는 GIF를 생성하는 도구가 아니라, `source/01_cat.png`를 원본 그대로 유지한 채 Y축 정수 오프셋으로 호흡 모션을 미리보기하는 Windows 실행 파일(`.exe`)입니다.

## 목적
1. 픽셀/색상/윤곽선을 바꾸지 않고 호흡 모션 품질을 확인합니다.
2. UI 통합 전에 모션 로직(사인파 + 정수 스냅)을 독립적으로 검증합니다.
3. 최종 오버레이 기능 개발 시 동일 원리를 재사용하기 위한 기준 샘플로 사용합니다.

## 산출물
1. 실행 파일: `build-mingw/OverlayBreathingPreview.exe`
2. 실행용 이미지: `build-mingw/source/01_cat.png` (빌드 후 자동 복사)
3. 원본 이미지: `source/01_cat.png`

## 빌드 방법 (WSL)
프로젝트 루트(`c:/Users/jinhy/DesktopPetOverlay`) 기준으로 아래를 실행합니다.

```bash
cmake -S . -B build-mingw -DCMAKE_SYSTEM_NAME=Windows -DCMAKE_CXX_COMPILER=x86_64-w64-mingw32-g++
cmake --build build-mingw -j
```

## 실행 방법 (Windows)
PowerShell에서 프로젝트 루트로 이동 후 실행합니다.

```powershell
.\build-mingw\OverlayBreathingPreview.exe
```

## 정상 동작 기준
1. 창 제목이 `Breathing Motion Preview`로 표시됩니다.
2. 고양이 이미지가 중앙에 표시됩니다.
3. 이미지가 위아래로 약 `±1~2px` 범위에서 반복 이동합니다.
4. 이미지 자체의 색상/윤곽선/해상도 변화가 없어야 합니다.

## 문제 발생 시 점검
1. 실행 직후 종료되면 `build-mingw/source/01_cat.png` 존재 여부를 확인합니다.
2. 실행 파일이 잠겨 빌드가 실패하면 `OverlayBreathingPreview.exe` 프로세스를 종료 후 재빌드합니다.
3. 오류 메시지 박스가 뜨면 표시된 `HRESULT` 값을 기준으로 초기화 실패 지점을 확인합니다.
