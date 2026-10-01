# Host-side Hexagon backend. DSP code is built by build-hexagon.sh from the
# same pinned GGML source; do not reuse llama.rn's different DSP ABI.
set(VIDEO_HEXAGON_ROOT "${SD_SOURCE}/../hexagon-runtime")
set(VIDEO_HEXAGON_SDK "${SD_SOURCE}/../hexagon-sdk/6.4.0.2")
if(NOT EXISTS "${VIDEO_HEXAGON_ROOT}/htp_iface_stub.c")
  message(FATAL_ERROR "Run scripts/video/build-hexagon.sh before building Android video.")
endif()
add_library(htp_iface OBJECT "${VIDEO_HEXAGON_ROOT}/htp_iface_stub.c")
set_target_properties(htp_iface PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_include_directories(htp_iface PUBLIC
  "${VIDEO_HEXAGON_SDK}/incs" "${VIDEO_HEXAGON_SDK}/incs/stddef"
  "${VIDEO_HEXAGON_SDK}/ipc/fastrpc/rpcmem/inc"
  "${VIDEO_HEXAGON_SDK}/utils/examples" "${CMAKE_CURRENT_SOURCE_DIR}/htp"
  "${VIDEO_HEXAGON_ROOT}")
target_link_options(htp_iface PUBLIC -llog -ldl)
ggml_add_backend_library(ggml-hexagon ggml-hexagon.cpp htp-drv.cpp htp-drv.h libdl.h ../../include/ggml-hexagon.h)
target_link_libraries(ggml-hexagon PRIVATE htp_iface)
target_include_directories(ggml-hexagon PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/htp" "${VIDEO_HEXAGON_ROOT}")
