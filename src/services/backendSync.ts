/**
 * Backend-default projection — the SINGLE place the device's GPU capability is
 * mapped onto the default inference backend at boot.
 *
 * Why this exists: on Android the static store default is CPU (a safe fallback),
 * so on a fresh install a device with a perfectly good GPU sits on CPU-only
 * inference and never uses it. This runs ONCE at boot and, when the user has NOT
 * manually chosen a backend, upgrades the default to the GPU path (OpenCL /
 * LiteRT gpu) if the device supports it.
 *
 * Separation of concerns (MVVM-ish):
 *  - The View (the backend selector) only dispatches an intent when the user
 *    picks a backend: `updateSettings({ inferenceBackend, backendUserChosen: true })`.
 *    Once chosen, this sync never overrides it again.
 *  - The capability -> backend mapping lives ONCE in backendResolver; this
 *    module reads real caps (hardwareService + Platform.OS) and projects the
 *    resolved default onto the store.
 */
import { Platform } from 'react-native';
import { useAppStore } from '../stores';
import { hardwareService } from './hardware';
import { resolveDefaultBackend, resolveDefaultLiteRTBackend } from './backendResolver';

/**
 * Apply the resolved GPU default ONCE at boot, unless the user has already
 * chosen a backend.
 *
 * SINGLETON: safe to call more than once — App's boot effect can re-run, and we
 * must never run the capability probe / override twice. Repeated calls return
 * the SAME in-flight (or settled) promise; the probe + store write happen
 * exactly once per app lifetime.
 */
let activePromise: Promise<void> | null = null;

export function startBackendDefaultSync(): Promise<void> {
  if (activePromise) return activePromise; // already ran / running — don't repeat
  activePromise = runOnce();
  return activePromise;
}

async function runOnce(): Promise<void> {
  const state = useAppStore.getState();
  // The user explicitly picked a backend — respect it, never override.
  if (state.settings?.backendUserChosen) return;

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const { supported: openCLSupported } = await hardwareService.getOpenCLCapability();
  // NPU (Hexagon) is Qualcomm-only: hardwareService.getSoCInfo().hasNPU is already
  // gated to vendor==='qualcomm'. The resolver only auto-defaults flagship variants
  // to the NPU; every other chip (incl. MediaTek/Exynos/Tensor Mali) falls to GPU.
  const soc = await hardwareService.getSoCInfo();
  const caps = {
    platform,
    openCLSupported,
    npuSupported: !!soc.hasNPU,
    npuVariant: soc.qnnVariant,
  } as const;

  const inferenceBackend = resolveDefaultBackend(caps);
  const liteRTBackend = resolveDefaultLiteRTBackend(caps);
  const enableGpu = inferenceBackend !== 'cpu';

  // Re-check under the latest state in case the user chose during the probe.
  if (useAppStore.getState().settings?.backendUserChosen) return;

  useAppStore.getState().updateSettings({ inferenceBackend, liteRTBackend, enableGpu });
}

/** Test-only: reset the singleton so each test starts fresh. */
export function __resetBackendDefaultSyncForTests(): void {
  activePromise = null;
}
