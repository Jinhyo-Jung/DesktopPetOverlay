#include "Renderer.h"

#include <cmath>

#pragma comment(lib, "d2d1.lib")
#pragma comment(lib, "windowscodecs.lib")

namespace
{
float QpcDeltaSeconds(const LARGE_INTEGER& Prev, const LARGE_INTEGER& Now, const LARGE_INTEGER& Freq) noexcept
{
    const double Delta = static_cast<double>(Now.QuadPart - Prev.QuadPart);
    const double Hz = static_cast<double>(Freq.QuadPart);
    return static_cast<float>(Delta / Hz);
}
} // namespace

HRESULT Renderer::Initialize(HWND Hwnd, const std::wstring& PngPath)
{
    Hwnd_ = Hwnd;
    PngPath_ = PngPath;

    QueryPerformanceFrequency(&QpcFreq_);
    QueryPerformanceCounter(&QpcPrev_);
    Motion_.SetParams(2.0f, 3.0f);

    HRESULT Hr = CoCreateInstance(
        CLSID_WICImagingFactory,
        nullptr,
        CLSCTX_INPROC_SERVER,
        IID_PPV_ARGS(WicFactory_.ReleaseAndGetAddressOf()));
    if (FAILED(Hr))
    {
        return Hr;
    }

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

    return LoadPngAsBitmap(PngPath_);
}

HRESULT Renderer::CreateDeviceResources(HWND Hwnd)
{
    if (RenderTarget_)
    {
        return S_OK;
    }

    RECT Rc{};
    GetClientRect(Hwnd, &Rc);

    const D2D1_SIZE_U Size = D2D1::SizeU(
        static_cast<UINT>(Rc.right - Rc.left),
        static_cast<UINT>(Rc.bottom - Rc.top));

    return D2dFactory_->CreateHwndRenderTarget(
        D2D1::RenderTargetProperties(
            D2D1_RENDER_TARGET_TYPE_DEFAULT,
            D2D1::PixelFormat(DXGI_FORMAT_UNKNOWN, D2D1_ALPHA_MODE_PREMULTIPLIED)),
        D2D1::HwndRenderTargetProperties(Hwnd, Size),
        RenderTarget_.ReleaseAndGetAddressOf());
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
    if (!RenderTarget_ || !WicFactory_)
    {
        return E_FAIL;
    }

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

    return RenderTarget_->CreateBitmapFromWicBitmap(
        Converter.Get(),
        nullptr,
        CatBitmap_.ReleaseAndGetAddressOf());
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
    RenderTarget_->Clear(D2D1::ColorF(0, 0, 0, 0));

    const int32_t OffsetY = Motion_.GetOffsetYPx();
    const D2D1_SIZE_F BitmapSize = CatBitmap_->GetSize();
    const D2D1_SIZE_F RtSize = RenderTarget_->GetSize();

    const float BaseX = (RtSize.width - BitmapSize.width) * 0.5f;
    const float BaseY = (RtSize.height - BitmapSize.height) * 0.5f;

    const float DrawX = std::round(BaseX);
    const float DrawY = std::round(BaseY + static_cast<float>(OffsetY));

    const D2D1_RECT_F DestRect = D2D1::RectF(
        DrawX,
        DrawY,
        DrawX + BitmapSize.width,
        DrawY + BitmapSize.height);

    RenderTarget_->DrawBitmap(
        CatBitmap_.Get(),
        DestRect,
        1.0f,
        D2D1_BITMAP_INTERPOLATION_MODE_NEAREST_NEIGHBOR);

    const HRESULT Hr = RenderTarget_->EndDraw();
    if (Hr == D2DERR_RECREATE_TARGET)
    {
        CatBitmap_.Reset();
        RenderTarget_.Reset();
        if (SUCCEEDED(CreateDeviceResources(Hwnd_)))
        {
            LoadPngAsBitmap(PngPath_);
        }
    }
}
