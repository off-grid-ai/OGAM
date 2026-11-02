#pragma once
#include <cstdint>
#include <cstring>

namespace offgrid {
// A diffusion graph whose latents went non-finite still decodes: every pixel saturates to one colour
// (pure white on Metal, 2026-11-02). No real picture is one flat colour, so such a frame is a failed run.
inline bool isBlankImage(const uint8_t *data, uint32_t width, uint32_t height, uint32_t channels) {
  if (!data || channels == 0) return true;
  const uint64_t pixels = uint64_t(width) * height;
  for (uint64_t i = 1; i < pixels; i++) {
    if (std::memcmp(data, data + i * channels, channels) != 0) return false;
  }
  return true;
}
} // namespace offgrid
