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
    std::wstring PngPath_;

    Microsoft::WRL::ComPtr<ID2D1Factory> D2dFactory_;
    Microsoft::WRL::ComPtr<ID2D1HwndRenderTarget> RenderTarget_;

    Microsoft::WRL::ComPtr<IWICImagingFactory> WicFactory_;
    Microsoft::WRL::ComPtr<ID2D1Bitmap> CatBitmap_;

    BreathingMotion Motion_;

    LARGE_INTEGER QpcFreq_{};
    LARGE_INTEGER QpcPrev_{};
};
