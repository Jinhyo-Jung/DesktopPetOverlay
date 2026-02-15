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

if(MINGW)
    target_link_options(OverlayBreathingPreview PRIVATE
        -static
        -static-libgcc
        -static-libstdc++
    )
endif()

add_custom_command(TARGET OverlayBreathingPreview POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E make_directory "$<TARGET_FILE_DIR:OverlayBreathingPreview>/source"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${CMAKE_CURRENT_SOURCE_DIR}/../source/01_cat.png"
        "$<TARGET_FILE_DIR:OverlayBreathingPreview>/source/01_cat.png"
)
