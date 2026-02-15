#pragma once

#include <cmath>
#include <cstdint>

class BreathingMotion
{
public:
    void SetParams(float AmplitudePx, float PeriodSec) noexcept
    {
        AmplitudePx_ = AmplitudePx;
        PeriodSec_ = (PeriodSec > 0.001f) ? PeriodSec : 0.001f;
    }

    void Update(float DeltaSec) noexcept
    {
        TimeSec_ += DeltaSec;

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
        return static_cast<int32_t>(std::lround(Raw));
    }

private:
    float AmplitudePx_ = 2.0f;
    float PeriodSec_ = 3.0f;
    float TimeSec_ = 0.0f;
};
