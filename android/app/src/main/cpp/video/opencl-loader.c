// The phone's OpenCL, found at run time. Linking libOpenCL.so directly stops the whole video engine
// from loading on a phone that has none (Pixels), so ggml's OpenCL backend links these exports
// instead. Each jumps through a pointer filled from the phone's libOpenCL.so when the engine loads.
// Without one every call fails: clGetPlatformIDs returns CL_PLATFORM_NOT_FOUND_KHR, ggml finds no
// OpenCL device, and video runs where it ran before (ggml-opencl.cpp, "platform IDs not available").
#include <dlfcn.h>

// A test build names a library that is not there, to run as a phone without OpenCL.
#ifndef OFFGRID_CL_LIBRARY
#define OFFGRID_CL_LIBRARY "libOpenCL.so"
#endif

#define OFFGRID_CL_FUNCTIONS(X)                                                                    \
  X(clBuildProgram) X(clCreateBuffer) X(clCreateBufferWithProperties) X(clCreateCommandQueue)      \
  X(clCreateContext) X(clCreateImage) X(clCreateKernel) X(clCreateProgramWithBinary)               \
  X(clCreateProgramWithSource) X(clCreateSubBuffer) X(clEnqueueBarrierWithWaitList)                \
  X(clEnqueueCopyBuffer) X(clEnqueueFillBuffer) X(clEnqueueMapBuffer)                              \
  X(clEnqueueMarkerWithWaitList) X(clEnqueueNDRangeKernel) X(clEnqueueReadBuffer)                  \
  X(clEnqueueUnmapMemObject) X(clEnqueueWriteBuffer) X(clFinish) X(clFlush) X(clGetDeviceIDs)      \
  X(clGetDeviceInfo) X(clGetKernelSubGroupInfo) X(clGetKernelWorkGroupInfo) X(clGetPlatformIDs)    \
  X(clGetPlatformInfo) X(clGetProgramBuildInfo) X(clGetProgramInfo) X(clReleaseEvent)              \
  X(clReleaseKernel) X(clReleaseMemObject) X(clReleaseProgram) X(clSetKernelArg)                   \
  X(clWaitForEvents)

// CL_PLATFORM_NOT_FOUND_KHR. Only clGetPlatformIDs is reached without OpenCL; ggml stops there.
static long offgrid_cl_missing(void) { return -1001; }

#define OFFGRID_CL_POINTER(name) \
  __attribute__((visibility("hidden"))) void *offgrid_cl_##name = (void *)offgrid_cl_missing;
OFFGRID_CL_FUNCTIONS(OFFGRID_CL_POINTER)

// arm64 (the only ABI built with OpenCL): jump to the resolved function, arguments untouched.
#define OFFGRID_CL_TRAMPOLINE(name)                                                    \
  __asm__(".text\n.globl " #name "\n.hidden " #name "\n.type " #name ",%function\n" #name \
          ":\n adrp x16, offgrid_cl_" #name "\n ldr x16, [x16, :lo12:offgrid_cl_" #name  \
          "]\n br x16\n");
OFFGRID_CL_FUNCTIONS(OFFGRID_CL_TRAMPOLINE)

__attribute__((constructor)) static void offgrid_cl_load(void) {
  void *library = dlopen(OFFGRID_CL_LIBRARY, RTLD_NOW | RTLD_LOCAL);
  if (!library) return;
  void *resolved[] = {
#define OFFGRID_CL_RESOLVE(name) dlsym(library, #name),
      OFFGRID_CL_FUNCTIONS(OFFGRID_CL_RESOLVE)
  };
  // A driver missing any of them is treated as no OpenCL, never half of one.
  for (unsigned i = 0; i < sizeof resolved / sizeof *resolved; ++i)
    if (!resolved[i]) return;
  unsigned i = 0;
#define OFFGRID_CL_ASSIGN(name) offgrid_cl_##name = resolved[i++];
  OFFGRID_CL_FUNCTIONS(OFFGRID_CL_ASSIGN)
}
