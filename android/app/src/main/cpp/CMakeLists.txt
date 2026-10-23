cmake_minimum_required(VERSION 3.22)
project(lingua_native LANGUAGES C CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(WHISPER_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(WHISPER_CURL OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_METAL OFF CACHE BOOL "" FORCE)
set(GGML_BLAS OFF CACHE BOOL "" FORCE)
# The first Android build uses portable ARM NEON / x86 CPU kernels. Do not
# advertise Vulkan, Hexagon or NPU acceleration without a tested backend.
include(FetchContent)
FetchContent_Declare(whisper
    GIT_REPOSITORY https://github.com/ggml-org/whisper.cpp.git
    GIT_TAG 2eeeba56e9edd762b4b38467bab96c2517163158
    GIT_SHALLOW FALSE)
FetchContent_MakeAvailable(whisper)
add_library(lingua-whisper SHARED whisper-jni.cpp)
target_link_libraries(lingua-whisper PRIVATE whisper android log)
target_link_options(lingua-whisper PRIVATE "-Wl,-z,max-page-size=16384")
