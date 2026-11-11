/**
 * Why replies are slow on THIS phone, when the settings show it, and the one change that fixes it. Measured on the
 * onn tablet: the CPU wrote 4.5 tokens/s with 4 threads, but the Vulkan GPU only 2.1 and 8 threads only 2.1. Pure, so it is
 * tested without a device.
 */
import type { useAppStore } from '../stores/appStore';

type AppSettings = ReturnType<typeof useAppStore.getState>['settings'];

export interface SlowCause {
  kind: 'gpu' | 'threads' | 'unknown';
  /** Finishes "Replies are slow here (2.1 tok/s): ...". */
  text: string;
  /** One tap that applies the fix. */
  action?: { label: string; patch: Partial<AppSettings> };
}

export function slowCause(o: { gpuOn: boolean; gpuBackend: string; slowGpu: boolean; threads: number; recommendedThreads: number }): SlowCause {
  if (o.gpuOn && /vulkan/i.test(o.gpuBackend) && o.slowGpu) {
    return { kind: 'gpu', text: 'this model runs on the GPU, which is slower than the CPU on this device', action: { label: 'Use the CPU', patch: { inferenceBackend: 'cpu', backendUserChosen: true } as Partial<AppSettings> } };
  }
  if (o.threads > 0 && o.threads > o.recommendedThreads + 1) {
    return {
      kind: 'threads',
      text: `it uses ${o.threads} threads but only ${o.recommendedThreads} cores are fast, and the slow ones drag the rest`,
      action: { label: 'Use automatic threads', patch: { nThreads: 0 } },
    };
  }
  return { kind: 'unknown', text: 'a smaller model, or the settings test, may help' };
}
