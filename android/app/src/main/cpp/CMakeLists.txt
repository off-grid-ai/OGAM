cmake_minimum_required(VERSION 3.22)
project(appmodules LANGUAGES C CXX)
include(${REACT_ANDROID_DIR}/cmake-utils/ReactNative-application.cmake)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_C_VISIBILITY_PRESET hidden)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(SD_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SD_BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(SD_BUILD_SHARED_GGML_LIB OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(SD_WEBP OFF CACHE BOOL "" FORCE)
set(SD_WEBM OFF CACHE BOOL "" FORCE)
set(SD_METAL OFF CACHE BOOL "" FORCE)
set(SD_VULKAN ON CACHE BOOL "" FORCE)
set(SD_SOURCE "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../.video-build/source")
set(GGML_HEXAGON ON CACHE BOOL "" FORCE)
set(OFFGRID_VIDEO_HEXAGON_CMAKE "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../scripts/video/hexagon-prebuilt.cmake")
if(NOT EXISTS "${SD_SOURCE}/CMakeLists.txt")
  message(FATAL_ERROR "Run scripts/prepare-video-runtime.sh before building Android.")
endif()
set(SPIRV-Headers_DIR "${SD_SOURCE}/../vulkan-header-prefix/share/cmake/SPIRV-Headers")
set(Vulkan_INCLUDE_DIR "${SD_SOURCE}/../vulkan-header-prefix/include" CACHE PATH "Pinned Vulkan headers" FORCE)
string(TOLOWER "${CMAKE_HOST_SYSTEM_NAME}" VIDEO_HOST_OS)
# The NDK shader compiler can be too old for the pinned runtime. Use the host
# shaderc installation, or an explicit -DVulkan_GLSLC_EXECUTABLE path.
find_program(Vulkan_GLSLC_EXECUTABLE NAMES glslc glslc.exe
  HINTS "${SD_SOURCE}/../shaderc/bin" NO_CMAKE_FIND_ROOT_PATH REQUIRED)
if(CMAKE_HOST_SYSTEM_NAME STREQUAL "Darwin")
  # The NDK prepends its compiler directory even for host-program discovery.
  # Its clang cannot compile against the current macOS SDK. Use Xcode's host
  # toolchain for the shader generator; model libraries still use the NDK.
  execute_process(COMMAND xcrun --sdk macosx --find clang
    OUTPUT_VARIABLE VIDEO_HOST_CC OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
  execute_process(COMMAND xcrun --sdk macosx --find clang++
    OUTPUT_VARIABLE VIDEO_HOST_CXX OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
else()
  find_program(VIDEO_HOST_CC NAMES clang gcc cl NO_CMAKE_FIND_ROOT_PATH REQUIRED)
  find_program(VIDEO_HOST_CXX NAMES clang++ g++ cl NO_CMAKE_FIND_ROOT_PATH REQUIRED)
endif()
set(GGML_VULKAN_SHADERS_GEN_TOOLCHAIN "${CMAKE_BINARY_DIR}/video-host-toolchain.cmake")
file(WRITE "${GGML_VULKAN_SHADERS_GEN_TOOLCHAIN}"
  "set(CMAKE_C_COMPILER \"${VIDEO_HOST_CC}\")\nset(CMAKE_CXX_COMPILER \"${VIDEO_HOST_CXX}\")\nset(CMAKE_MAKE_PROGRAM \"${CMAKE_MAKE_PROGRAM}\" CACHE FILEPATH \"Host build tool\" FORCE)\n")
add_subdirectory("${SD_SOURCE}" runtime)
# Keep model execution representative in debug apps. Unoptimized tensor kernels
# make CPU conditioning take minutes even though the app remains responsive.
foreach(VIDEO_RUNTIME_TARGET stable-diffusion ggml-base ggml-cpu ggml-vulkan ggml-hexagon)
  if(TARGET ${VIDEO_RUNTIME_TARGET})
    target_compile_options(${VIDEO_RUNTIME_TARGET} PRIVATE $<$<CONFIG:Debug>:-O3>)
  endif()
endforeach()
add_library(offgrid_video SHARED video/video-jni.cpp)
target_include_directories(offgrid_video PRIVATE "${SD_SOURCE}/include" "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../native/video/common")
target_link_libraries(offgrid_video PRIVATE stable-diffusion android log)
target_link_options(offgrid_video PRIVATE "-Wl,--exclude-libs,ALL" "-Wl,-z,max-page-size=16384")
