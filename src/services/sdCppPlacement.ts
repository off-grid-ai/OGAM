/**
 * Where sd.cpp image models run on this phone, and how long an image takes there.
 *
 * Mirrors native/video/common/VideoRuntime.hpp: sd.cpp images never use the NPU, and on Adreno (every
 * Snapdragon) they run on the CPU because Adreno Vulkan crashes in the UNet. On such a phone a Local
 * Dream (MNN/QNN) model is the pick, and an sd.cpp model says how long an image takes.
 */
const GB = 1024 * 1024 * 1024;

// Measured on a OnePlus (SM8635), CPU, RealVisXL Lightning Q4 (2.67 GB pack) at 512 px, 10 steps,
// 2026-10-27: about 95 s to load and encode the prompt, about 117 s a step, and about 5 min to decode
// (26.2 min from send to the image).
const CPU_LOAD_SECONDS = 95;
const CPU_DECODE_SECONDS = 300;
const CPU_SECONDS_PER_STEP_PER_PACK_GB = 117 / 2.67;

/** True where sd.cpp images can only run on the CPU: an Android phone with a Qualcomm (Adreno) GPU. */
export function sdCppRunsOnCpu(platform: string, socVendor: string | undefined): boolean {
  return platform === 'android' && socVendor === 'qualcomm';
}

/** Minutes for one image on the CPU, scaled from the measurement by pack size and step count. */
export function sdCppCpuMinutesPerImage(packBytes: number, steps: number): number {
  const seconds = CPU_LOAD_SECONDS + CPU_DECODE_SECONDS + steps * CPU_SECONDS_PER_STEP_PER_PACK_GB * (packBytes / GB);
  return Math.max(1, Math.round(seconds / 60));
}
