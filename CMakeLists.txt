cmake_minimum_required(VERSION 3.20)
project(OverlayBreathingPreview LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

add_executable(OverlayBreathingPreview WIN32
    src/Main.cpp
    src/Renderer.cpp
)

target_include_directories(OverlayBreathingPreview PRIVATE src)

target_link_libraries(OverlayBreathingPreview PRIVATE
    d2d1
    windowscodecs
)
