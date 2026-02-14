#include <windows.h>

#include <string>

#include "Renderer.h"

namespace
{
Renderer GRenderer;
} // namespace

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
        return DefWindowProcW(Hwnd, Msg, WParam, LParam);
    }
}

int WINAPI wWinMain(HINSTANCE Instance, HINSTANCE, PWSTR, int CmdShow)
{
    const HRESULT HrInit = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(HrInit))
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

    const std::wstring PngPath = L"./source/01_cat.png";
    const HRESULT HrRenderer = GRenderer.Initialize(Hwnd, PngPath);
    if (FAILED(HrRenderer))
    {
        CoUninitialize();
        return -1;
    }

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
        Sleep(10);
    }
}
