```md
# Desktop Overlay Breathing Motion (Code-Driven) - Codex Agent Guide

이 문서는 **이 문서만 읽고도** 코덱스(Codex) 에이전트가 `./source/01_cat.png`를 로드하여 **픽셀/색상/윤곽선을 바꾸지 않고** “호흡(breathing) 모션”을 구현할 수 있도록 작성된 구현 가이드입니다.

- 핵심: **이미지를 재생성/변형하지 않고**, 렌더링 시 **Y 좌표만 ±1~2px** 이동합니다.
- 장점: 색상/윤곽선/해상도 100% 보존, 모션 블러 없음, 루프 완전 보장

---

## 1단계. 요구사항(반드시 지키기)

1. `./source/01_cat.png` 파일을 그대로 사용합니다.  
2. 이미지 자체를 리샘플링/필터링/재인코딩하지 않습니다.  
3. 호흡 모션은 **Y축 정수 픽셀 오프셋**만 사용합니다. (`-2, -1, 0, 1, 2` 등)  
4. 보간(Interpolation)은 **Nearest Neighbor**로 설정합니다.  
5. 루프는 사인파 기반으로 구현하되, 최종 오프셋은 `lround()`로 정수화합니다.

---

## 2단계. 구현 선택(가장 일반적인 Windows 네이티브)

본 문서는 **Win32 + Direct2D + WIC** 기준으로 작성합니다.

- Direct2D: 빠른 2D 렌더링
- WIC(Windows Imaging Component): PNG 로드(알파 포함)
- COM은 **RAII 기반 스마트 포인터(ComPtr)** 로만 관리합니다.

---

## 3단계. 프로젝트 구조(권장)

```

ProjectRoot/
source/
01_cat.png
src/
Main.cpp
Renderer.h
Renderer.cpp
BreathingMotion.h
CMakeLists.txt

```

---

## 4단계. 호흡 모션 수학(정의 포함)

- **Breathing(호흡)**: 시간에 따라 아주 작은 상하 이동만 주는 애니메이션
- 공식:

```

OffsetY(t) = round(AmplitudePx * sin(2π * t / PeriodSec))

````

권장 파라미터:
- `AmplitudePx = 1.0f ~ 2.0f`
- `PeriodSec = 3.0f` (약 3초에 한 번 들숨/날숨)

**중요**: `round/lround`로 정수 픽셀 스냅을 해야 윤곽선이 흐려지지 않습니다.

---

## 5단계. 코드 작성

### 5-1. `src/BreathingMotion.h`

```cpp
#pragma once
#include <cmath>
#include <cstdint>

class BreathingMotion
{
public:
    void SetParams(float AmplitudePx, float PeriodSec) noexcept
    {
        AmplitudePx_ = AmplitudePx;
        PeriodSec_ = (PeriodSec > 0.001f) ? PeriodSec : 0.001f; // 필수 최소 에러 방어
    }

    void Update(float DeltaSec) noexcept
    {
        TimeSec_ += DeltaSec;

        // 드물게 float 정밀도 이슈 방지(필수 수준의 방어)
        if (TimeSec_ > 100000.0f)
        {
            TimeSec_ = std::fmod(TimeSec_, PeriodSec_);
        }
    }

    int32_t GetOffsetYPx() const noexcept
    {
        constexpr float TwoPi = 6.283185307179586f;
        const float Phase = TwoPi * (TimeSec_ / PeriodSec_);
        const float Raw = AmplitudePx_ * std::sin(Phase);

        // 윤곽선 보존: 정수 픽셀 스냅
        return static_cast<int32_t>(std::lround(Raw));
    }

private:
    float AmplitudePx_ = 1.0f;
    float PeriodSec_ = 3.0f;
    float TimeSec_ = 0.0f;
};
````

---

### 5-2. `src/Renderer.h`

```cpp
#pragma once

#include <windows.h>
#include <d2d1.h>
#include <wincodec.h>
#include <wrl/client.h>

#include <string>
#include "BreathingMotion.h"

class Renderer
{
public:
    Renderer() = default;

    HRESULT Initialize(HWND Hwnd, const std::wstring& PngPath);
    void Resize(UINT Width, UINT Height);
    void TickAndRender();

private:
    HRESULT CreateDeviceResources(HWND Hwnd);
    HRESULT LoadPngAsBitmap(const std::wstring& PngPath);
    void RenderFrame();

private:
    HWND Hwnd_ = nullptr;

    Microsoft::WRL::ComPtr<ID2D1Factory> D2dFactory_;
    Microsoft::WRL::ComPtr<ID2D1HwndRenderTarget> RenderTarget_;

    Microsoft::WRL::ComPtr<IWICImagingFactory> WicFactory_;
    Microsoft::WRL::ComPtr<ID2D1Bitmap> CatBitmap_;

    BreathingMotion Motion_;

    LARGE_INTEGER QpcFreq_{};
    LARGE_INTEGER QpcPrev_{};
};
```

---

### 5-3. `src/Renderer.cpp`

```cpp
#include "Renderer.h"
#include <cassert>

#pragma comment(lib, "d2d1.lib")
#pragma comment(lib, "windowscodecs.lib")

static float QpcDeltaSeconds(const LARGE_INTEGER& Prev, const LARGE_INTEGER& Now, const LARGE_INTEGER& Freq) noexcept
{
    const double Delta = static_cast<double>(Now.QuadPart - Prev.QuadPart);
    const double Hz = static_cast<double>(Freq.QuadPart);
    return static_cast<float>(Delta / Hz);
}

HRESULT Renderer::Initialize(HWND Hwnd, const std::wstring& PngPath)
{
    Hwnd_ = Hwnd;

    QueryPerformanceFrequency(&QpcFreq_);
    QueryPerformanceCounter(&QpcPrev_);

    Motion_.SetParams(2.0f, 3.0f); // Amplitude=2px, Period=3sec

    // WIC Factory
    HRESULT Hr = CoCreateInstance(
        CLSID_WICImagingFactory,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(WicFactory_.ReleaseAndGetAddressOf()));

    if (FAILED(Hr))
    {
        return Hr;
    }

    // D2D Factory
    Hr = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, D2dFactory_.ReleaseAndGetAddressOf());
    if (FAILED(Hr))
    {
        return Hr;
    }

    Hr = CreateDeviceResources(Hwnd_);
    if (FAILED(Hr))
    {
        return Hr;
    }

    Hr = LoadPngAsBitmap(PngPath);
    if (FAILED(Hr))
    {
        return Hr;
    }

    return S_OK;
}

HRESULT Renderer::CreateDeviceResources(HWND Hwnd)
{
    RECT Rc{};
    GetClientRect(Hwnd, &Rc);

    const D2D1_SIZE_U Size = D2D1::SizeU(
        static_cast<UINT>(Rc.right - Rc.left),
        static_cast<UINT>(Rc.bottom - Rc.top));

    HRESULT Hr = D2dFactory_->CreateHwndRenderTarget(
        D2D1::RenderTargetProperties(
            D2D1_RENDER_TARGET_TYPE_DEFAULT,
            D2D1::PixelFormat(DXGI_FORMAT_UNKNOWN, D2D1_ALPHA_MODE_PREMULTIPLIED)),
        D2D1::HwndRenderTargetProperties(Hwnd, Size),
        RenderTarget_.ReleaseAndGetAddressOf());

    return Hr;
}

void Renderer::Resize(UINT Width, UINT Height)
{
    if (RenderTarget_)
    {
        RenderTarget_->Resize(D2D1::SizeU(Width, Height));
    }
}

HRESULT Renderer::LoadPngAsBitmap(const std::wstring& PngPath)
{
    Microsoft::WRL::ComPtr<IWICBitmapDecoder> Decoder;
    HRESULT Hr = WicFactory_->CreateDecoderFromFilename(
        PngPath.c_str(),
        nullptr,
        GENERIC_READ,
        WICDecodeMetadataCacheOnLoad,
        Decoder.ReleaseAndGetAddressOf());

    if (FAILED(Hr))
    {
        return Hr;
    }

    Microsoft::WRL::ComPtr<IWICBitmapFrameDecode> Frame;
    Hr = Decoder->GetFrame(0, Frame.ReleaseAndGetAddressOf());
    if (FAILED(Hr))
    {
        return Hr;
    }

    // PNG를 32bppPBGRA로 변환 (Direct2D 호환 + 알파 유지)
    Microsoft::WRL::ComPtr<IWICFormatConverter> Converter;
    Hr = WicFactory_->CreateFormatConverter(Converter.ReleaseAndGetAddressOf());
    if (FAILED(Hr))
    {
        return Hr;
    }

    Hr = Converter->Initialize(
        Frame.Get(),
        GUID_WICPixelFormat32bppPBGRA,
        WICBitmapDitherTypeNone,
        nullptr,
        0.0,
        WICBitmapPaletteTypeCustom);

    if (FAILED(Hr))
    {
        return Hr;
    }

    // D2D Bitmap 생성
    Hr = RenderTarget_->CreateBitmapFromWicBitmap(
        Converter.Get(),
        nullptr,
        CatBitmap_.ReleaseAndGetAddressOf());

    return Hr;
}

void Renderer::TickAndRender()
{
    LARGE_INTEGER QpcNow{};
    QueryPerformanceCounter(&QpcNow);

    const float DeltaSec = QpcDeltaSeconds(QpcPrev_, QpcNow, QpcFreq_);
    QpcPrev_ = QpcNow;

    Motion_.Update(DeltaSec);
    RenderFrame();
}

void Renderer::RenderFrame()
{
    if (!RenderTarget_ || !CatBitmap_)
    {
        return;
    }

    RenderTarget_->BeginDraw();

    // 배경은 검정으로 지우지 않음(오버레이 목적이면 투명 처리/레이어드 윈도우를 별도로 구성해야 함)
    // 여기서는 샘플 창에서 표시만 하므로 Clear는 생략하거나 원하는 색을 사용하셔도 됩니다.
    RenderTarget_->Clear(D2D1::ColorF(0, 0, 0, 0));

    const int32_t OffsetY = Motion_.GetOffsetYPx();

    const D2D1_SIZE_F BitmapSize = CatBitmap_->GetSize();

    // 화면 중앙 배치
    D2D1_SIZE_F RtSize = RenderTarget_->GetSize();
    const float BaseX = (RtSize.width - BitmapSize.width) * 0.5f;
    const float BaseY = (RtSize.height - BitmapSize.height) * 0.5f;

    // 정수 픽셀 스냅(윤곽선 흐림 방지)
    const float DrawX = std::round(BaseX);
    const float DrawY = std::round(BaseY + static_cast<float>(OffsetY));

    const D2D1_RECT_F DestRect = D2D1::RectF(
        DrawX,
        DrawY,
        DrawX + BitmapSize.width,
        DrawY + BitmapSize.height);

    // Nearest Neighbor로 보간(윤곽선 보존)
    RenderTarget_->DrawBitmap(
        CatBitmap_.Get(),
        DestRect,
        1.0f,
        D2D1_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR);

    const HRESULT Hr = RenderTarget_->EndDraw();

    // 필수 수준의 에러 처리: 장치 손실 시 리소스 재생성 정도만
    if (Hr == D2DERR_RECREATE_TARGET)
    {
        RenderTarget_.Reset();
        CreateDeviceResources(Hwnd_);
        LoadPngAsBitmap(L"./source/01_cat.png");
    }
}
```

---

### 5-4. `src/Main.cpp`

```cpp
#include <windows.h>
#include <string>
#include "Renderer.h"

static Renderer GRenderer;

LRESULT CALLBACK WndProc(HWND Hwnd, UINT Msg, WPARAM WParam, LPARAM LParam)
{
    switch (Msg)
    {
    case WM_SIZE:
    {
        const UINT Width = LOWORD(LParam);
        const UINT Height = HIWORD(LParam);
        GRenderer.Resize(Width, Height);
        return 0;
    }
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    default:
        return DefWindowProc(Hwnd, Msg, WParam, LParam);
    }
}

int WINAPI wWinMain(HINSTANCE Instance, HINSTANCE, PWSTR, int CmdShow)
{
    // COM 초기화
    HRESULT Hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(Hr))
    {
        return -1;
    }

    const wchar_t* ClassName = L"OverlayBreathingPreviewWindow";

    WNDCLASSW Wc{};
    Wc.lpfnWndProc = WndProc;
    Wc.hInstance = Instance;
    Wc.lpszClassName = ClassName;
    RegisterClassW(&Wc);

    HWND Hwnd = CreateWindowExW(
        0,
        ClassName,
        L"Breathing Motion Preview",
        WS_OVERLAPPEDWINDOW,
        CW_USEDEFAULT, CW_USEDEFAULT, 800, 600,
        nullptr, nullptr, Instance, nullptr);

    if (!Hwnd)
    {
        CoUninitialize();
        return -1;
    }

    ShowWindow(Hwnd, CmdShow);

    // PNG 경로
    const std::wstring PngPath = L"./source/01_cat.png";

    Hr = GRenderer.Initialize(Hwnd, PngPath);
    if (FAILED(Hr))
    {
        CoUninitialize();
        return -1;
    }

    // 메시지 루프 + 렌더 루프
    MSG Msg{};
    while (true)
    {
        while (PeekMessageW(&Msg, nullptr, 0, 0, PM_REMOVE))
        {
            if (Msg.message == WM_QUIT)
            {
                CoUninitialize();
                return 0;
            }
            TranslateMessage(&Msg);
            DispatchMessageW(&Msg);
        }

        GRenderer.TickAndRender();
        Sleep(10); // 과도한 CPU 점유 방지(필수 수준)
    }
}
```

---

## 6단계. CMake 설정(예시)

### `CMakeLists.txt`

```cmake
cmake_minimum_required(VERSION 3.20)
project(OverlayBreathingPreview LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(OverlayBreathingPreview
    src/Main.cpp
    src/Renderer.cpp
)

target_include_directories(OverlayBreathingPreview PRIVATE src)

target_link_libraries(OverlayBreathingPreview PRIVATE
    d2d1
    windowscodecs
)
```

---

## 7단계. 실행 확인 체크리스트

1. `./source/01_cat.png`가 실행 파일 기준 상대경로로 존재하는지 확인합니다.
2. 고양이가 **정확히 그대로** 그려지는지 확인합니다(색/윤곽선 변화 없어야 함).
3. 위아래로 **1~2px** 정도만 움직이는지 확인합니다.
4. 움직임이 튀지 않는지 확인합니다(사인파 + 정수 스냅).
5. 윤곽선이 흐려지면:

   * `DrawBitmap` 보간이 `NEAREST_NEIGHBOR`인지 확인
   * 좌표가 정수로 스냅되는지 확인(`round`/`lround`)

---

## 8단계. Codex 에이전트에게 줄 작업 지시문(그대로 붙여넣기)

아래 지시문을 코덱스 에이전트에 그대로 입력하시면 됩니다.

```
목표:
- ./source/01_cat.png 를 로드하여 이미지 자체를 변경하지 않고 호흡(breathing) 모션을 구현한다.
- PNG 픽셀/색상/윤곽선은 100% 유지한다.
- 렌더링 시 Y좌표를 ±1~2px 정수 단위로만 이동한다.
- Direct2D + WIC로 PNG를 32bppPBGRA로 로드하고 DrawBitmap은 NEAREST_NEIGHBOR를 사용한다.
- 시간 기반 사인파: OffsetY = lround(AmplitudePx * sin(2π * t / PeriodSec))
- RAII 기반 ComPtr만 사용한다.
- 프로젝트 구조는 문서의 구조를 따른다.
- 위 문서의 코드(Main.cpp/Renderer.h/Renderer.cpp/BreathingMotion.h/CMakeLists.txt)를 생성하고 빌드 가능 상태로 만든다.
```

---

## 9단계. 오버레이(진짜 투명 윈도우)로 확장할 때(참고)

본 문서는 “미리보기 창”입니다. 실제 오버레이로 가려면:

* `WS_EX_LAYERED`, `WS_EX_TRANSPARENT`, DWM 연동 등 윈도우 스타일 설계가 필요합니다.
* 하지만 **호흡 모션의 핵심(좌표만 이동)** 은 동일합니다.

원하시면 “투명 클릭-스루 오버레이 창”까지 확장한 버전 문서도 작성해드릴 수 있습니다.

```
```
