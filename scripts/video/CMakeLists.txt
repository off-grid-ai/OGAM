cmake_minimum_required(VERSION 3.24)
project(OffgridVideoRuntime LANGUAGES C CXX OBJC OBJCXX)
set(SD_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(SD_BUILD_SHARED_LIBS ON CACHE BOOL "" FORCE)
set(SD_BUILD_SHARED_GGML_LIB OFF CACHE BOOL "" FORCE)
set(SD_METAL ON CACHE BOOL "" FORCE)
set(SD_WEBP OFF CACHE BOOL "" FORCE)
set(SD_WEBM OFF CACHE BOOL "" FORCE)
set(GGML_METAL_EMBED_LIBRARY ON CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(CMAKE_C_VISIBILITY_PRESET hidden)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
add_subdirectory("${SD_SOURCE}" runtime)
target_sources(stable-diffusion PRIVATE "${SD_SOURCE}/include/stable-diffusion.h")
set_target_properties(stable-diffusion PROPERTIES
  FRAMEWORK TRUE FRAMEWORK_VERSION A
  OUTPUT_NAME OffgridVideoRuntime
  MACOSX_FRAMEWORK_IDENTIFIER ai.offgrid.video.runtime
  XCODE_ATTRIBUTE_PRODUCT_BUNDLE_IDENTIFIER ai.offgrid.video.runtime
  PUBLIC_HEADER "${SD_SOURCE}/include/stable-diffusion.h"
  XCODE_ATTRIBUTE_CODE_SIGNING_ALLOWED NO
  INSTALL_NAME_DIR "@rpath")
target_link_options(stable-diffusion PRIVATE "-Wl,-exported_symbols_list,${CMAKE_CURRENT_SOURCE_DIR}/exports.txt")
