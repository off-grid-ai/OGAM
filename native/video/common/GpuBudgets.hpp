#pragma once
// The --max-vram budget list for a phone's video run, built from the devices ggml reports. Pure (no
// ggml calls) so it can be tested on its own: native/video/common/tests/GpuBudgetsTest.cpp.
#include <string>
#include <vector>

struct BudgetDevice {
  std::string name;
  bool gpu; // a GPU or integrated GPU; other devices (CPU, the NPU) get no GPU budget
};

// HTP0 (the Hexagon NPU) keeps 1.5 GiB, but only on a phone that has it: stable-diffusion.cpp rejects
// a budget for a backend it does not know, so a fixed "HTP0=1.5" failed every video model on Pixel,
// Exynos and MediaTek phones (OGAM#787, "unknown --max-vram backend 'HTP0'"). The compute device gets
// the free RAM; every other GPU gets none (-1024 GiB), so nothing is placed there.
inline std::string gpuBudgets(const std::vector<BudgetDevice> &devices, const std::string &computeDevice,
                              long availableKb) {
  std::string budgets;
  const auto add = [&budgets](const std::string &entry) {
    budgets += (budgets.empty() ? "" : ",") + entry;
  };
  for (const auto &device : devices) {
    if (device.name == "HTP0") add("HTP0=1.5");
  }
  for (const auto &device : devices) {
    if (!device.gpu) continue;
    const double gib = device.name == computeDevice && availableKb > 0 ? availableKb / (1024.0 * 1024.0) : -1024;
    add(device.name + "=" + std::to_string(gib));
  }
  return budgets;
}
