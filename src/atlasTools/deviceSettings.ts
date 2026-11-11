/**
 * Settings that belong to one device's hardware, not to the person: which backend runs the
 * model (NPU, GPU, CPU), threads, GPU layers, memory cache type, context size, which models
 * are on this device and which one is loaded. A backup restored on another device, or offline
 * sync, must never carry these across: a phone's NPU backend or thread count can stop every
 * model loading on a tablet. One rule, used by both backup restore and sync.
 */

/** Settings keys tied to hardware (backend, acceleration, threads, memory, context window). */
export const DEVICE_SETTING = /thread|gpu|opencl|vulkan|npu|backend|accel|cache|loading|classifier|layers|batch|flash|mmap|context|ctx/i;

/** App-store fields that describe this device's models and hardware. */
const DEVICE_FIELDS = [
  'downloadedModels', 'activeModelId', 'lastTextModelId', 'loadedTextModelId', 'activeImageModelId',
  'deviceInfo', 'modelRecommendation', 'warmedImageModels', 'loadedSettings', 'modelMaxContext',
];

/**
 * The app store to save on this device: the incoming one's personal choices, with this
 * device's hardware settings and model fields kept (or left out when this device has none yet,
 * so the app's defaults for this hardware apply).
 */
export function keepThisDevice(localRaw: string | null, incomingRaw: string): string {
  const incoming = JSON.parse(incomingRaw);
  const local = localRaw ? JSON.parse(localRaw) : null;
  const mine = local?.state ?? {};
  const theirs = incoming?.state ?? {};
  const personal = Object.fromEntries(Object.entries(theirs.settings ?? {}).filter(([k]) => !DEVICE_SETTING.test(k)));
  const hardware = Object.fromEntries(Object.entries(mine.settings ?? {}).filter(([k]) => DEVICE_SETTING.test(k)));
  const state: Record<string, unknown> = { ...theirs, settings: { ...personal, ...hardware } };
  for (const field of DEVICE_FIELDS) {
    if (field in mine) state[field] = mine[field];
    else delete state[field];
  }
  return JSON.stringify({ ...incoming, state, version: local?.version ?? incoming?.version });
}
