// The phone's --max-vram budget list. Run: scripts/test-native-video.sh
// OGAM#787: a Pixel 10 (no Hexagon NPU) failed every video model with
// "unknown --max-vram backend 'HTP0'", because the list always named HTP0.
#include "../GpuBudgets.hpp"
#include <cstdio>
#include <cstdlib>
#include <string>

static int failures = 0;
static void expectEq(const std::string &actual, const std::string &expected, const char *what) {
  if (actual == expected) return;
  std::fprintf(stderr, "FAIL %s\n  expected: %s\n  actual:   %s\n", what, expected.c_str(), actual.c_str());
  ++failures;
}

int main() {
  const long eightGibKb = 8L * 1024 * 1024;

  // Pixel (Tensor): Vulkan and the CPU, no HTP0. The list must not name a backend the phone lacks.
  expectEq(gpuBudgets({{"Vulkan0", true}, {"CPU", false}}, "Vulkan0", eightGibKb),
           "Vulkan0=8.000000", "a phone without the Hexagon NPU gets no HTP0 budget");

  // Snapdragon: HTP0 keeps its 1.5 GiB; the compute GPU gets the free RAM, another GPU none.
  expectEq(gpuBudgets({{"HTP0", false}, {"Vulkan0", true}, {"GPUOpenCL", true}, {"CPU", false}}, "GPUOpenCL",
                      eightGibKb),
           "HTP0=1.5,Vulkan0=-1024.000000,GPUOpenCL=8.000000", "a Snapdragon phone budgets HTP0 and its GPUs");

  // Free RAM unreadable: the compute GPU gets none rather than a made-up figure.
  expectEq(gpuBudgets({{"Vulkan0", true}}, "Vulkan0", 0), "Vulkan0=-1024.000000", "unknown free RAM leaves no budget");

  // CPU only: an empty list (sd.cpp then uses its own default).
  expectEq(gpuBudgets({{"CPU", false}}, "Vulkan0", eightGibKb), "", "a CPU-only phone gets no budgets");

  if (failures == 0) std::puts("GpuBudgetsTest: all passed");
  return failures == 0 ? EXIT_SUCCESS : EXIT_FAILURE;
}
