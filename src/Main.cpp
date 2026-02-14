#include <windows.h>

#include <iomanip>
#include <iterator>
#include <sstream>
#include <string>
#include <vector>

#include "Renderer.h"

namespace
{
Renderer GRenderer;

bool FileExists(const std::wstring& Path)
{
    const DWORD Attr = GetFileAttributesW(Path.c_str());
    return Attr != INVALID_FILE_ATTRIBUTES && !(Attr & FILE_ATTRIBUTE_DIRECTORY);
}

std::wstring GetExeDirectory()
{
    wchar_t Buffer[MAX_PATH]{};
    const DWORD Len = GetModuleFileNameW(nullptr, Buffer, static_cast<DWORD>(std::size(Buffer)));
    if (Len == 0 || Len >= MAX_PATH)
    {
        return L".";
    }

    std::wstring FullPath(Buffer, Len);
    const size_t Pos = FullPath.find_last_of(L"\\/");
    if (Pos == std::wstring::npos)
    {
        return L".";
    }
    return FullPath.substr(0, Pos);
}

std::wstring ResolvePngPath()
{
    const std::wstring ExeDir = GetExeDirectory();
    const std::vector<std::wstring> Candidates{
        L"./source/01_cat.png",
        L"../source/01_cat.png",
        ExeDir + L"\\source\\01_cat.png",
        ExeDir + L"\\..\\source\\01_cat.png"};

    for (const auto& Path : Candidates)
    {
        if (FileExists(Path))
        {
            return Path;
        }
    }
    return L"./source/01_cat.png";
}

void ShowInitError(const wchar_t* Stage, HRESULT Hr)
{
    std::wstringstream Ss;
    Ss << Stage << L" 실패. HRESULT=0x" << std::uppercase << std::hex << static_cast<unsigned long>(Hr);
    MessageBoxW(nullptr, Ss.str().c_str(), L"OverlayBreathingPreview Error", MB_ICONERROR | MB_OK);
}
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
        ShowInitError(L"COM 초기화", HrInit);
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
        ShowInitError(L"윈도우 생성", HRESULT_FROM_WIN32(GetLastError()));
        CoUninitialize();
        return -1;
    }

    ShowWindow(Hwnd, CmdShow);

    const std::wstring PngPath = ResolvePngPath();
    const HRESULT HrRenderer = GRenderer.Initialize(Hwnd, PngPath);
    if (FAILED(HrRenderer))
    {
        ShowInitError(L"렌더러 초기화/PNG 로드", HrRenderer);
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

int WINAPI WinMain(HINSTANCE Instance, HINSTANCE PrevInstance, LPSTR CmdLine, int CmdShow)
{
    return wWinMain(Instance, PrevInstance, nullptr, CmdShow);
}
