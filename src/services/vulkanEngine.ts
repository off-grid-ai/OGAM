import { NativeEventEmitter, NativeModules } from 'react-native';

/** Text-only llama.kt Vulkan engine. Never substitutes for llama.rn silently. */
type Backend = { name: string; description: string; type: string };
export type VulkanSamplingSettings = {
  temperature?: number; topK?: number; topP?: number; minP?: number;
  repeatPenalty?: number; stop?: string[];
};
/**
 * Why the Vulkan engine can or cannot run. A missing engine (not_packaged,
 * native_load_failed, sdk_unsupported) is a build/OS problem; no_vulkan_device is
 * the hardware/driver. Never infer either from the chipset name.
 */
export type VulkanRuntimeState =
  'ok' | 'not_packaged' | 'native_load_failed' | 'sdk_unsupported' | 'no_vulkan_device' | 'probe_failed';
export type VulkanRuntimeStatus = {
  status: VulkanRuntimeState; packaged: boolean; message: string; devices: Backend[]; sdkInt?: number;
};
/** offloadedGpuLayers: llama.cpp's assignment, min(requested, blocks + 1); -1 when unknown. */
export type VulkanLoadResult = {
  backend: string; requestedGpuLayers: number; offloadedGpuLayers: number; totalLayers: number;
};
type VulkanModule = {
  listBackends(): Promise<Backend[]>;
  runtimeStatus?(): Promise<VulkanRuntimeStatus>;
  loadModel(path: string, gpuLayers: number, context: number, threads: number): Promise<VulkanLoadResult | string>;
  activeBackend(): Promise<string>;
  formatChat(messagesJson: string): Promise<string>;
  tokenize(text: string): Promise<number[]>;
  generate(prompt: string, maxTokens: number, sessionId: string, samplingJson: string): Promise<boolean>;
  interrupt(sessionId: string): Promise<boolean>;
  unload(): Promise<boolean>;
};
const getNative = (): VulkanModule | null =>
  (NativeModules.AtlasVulkan as VulkanModule | undefined) ?? null;

const isVulkanGpu = (b: Backend) =>
  b.type.toLowerCase().includes('gpu') && /vulkan/i.test(`${b.description} ${b.name}`);

/** User-facing explanation for a non-ok runtime state. */
export function describeVulkanStatus(status: VulkanRuntimeStatus): string {
  switch (status.status) {
    case 'ok': return `Vulkan GPU: ${status.devices.filter(isVulkanGpu).map(d => d.name).join(', ') || 'detected'}`;
    case 'not_packaged': return 'The Vulkan engine (llama.kt) is not included in this APK. This is a build problem, not your GPU.';
    case 'native_load_failed': return `The Vulkan engine is in this APK but its native library failed to load: ${status.message}`;
    case 'sdk_unsupported': return 'The Vulkan engine needs Android 10 or newer.';
    case 'no_vulkan_device': return "The Vulkan engine is installed, but this device's driver reports no Vulkan GPU.";
    default: return `Vulkan device check failed: ${status.message}`;
  }
}

let activeSession: string | null = null;
let generationCounter = 0;

function required(): VulkanModule {
  const module = getNative();
  if (!module) throw new Error('Vulkan runtime not packaged in this APK');
  return module;
}

export const vulkanEngine = {
  async listBackends(): Promise<Backend[]> {
    const module = getNative();
    if (!module) return [];
    return module.listBackends();
  },
  async runtimeStatus(): Promise<VulkanRuntimeStatus> {
    const module = getNative();
    if (!module) {
      return { status: 'not_packaged', packaged: false, devices: [],
        message: 'The Vulkan bridge is not part of this app build' };
    }
    if (module.runtimeStatus) return module.runtimeStatus();
    try {
      const devices = await module.listBackends();
      const ok = devices.some(isVulkanGpu);
      return { status: ok ? 'ok' : 'no_vulkan_device', packaged: true, devices,
        message: ok ? 'Vulkan GPU detected' : 'No Vulkan GPU was reported by this device' };
    } catch (error: any) {
      const notPackaged = error?.code === 'VULKAN_NOT_PACKAGED' || error?.code === 'VULKAN_RUNTIME_UNAVAILABLE';
      return { status: notPackaged ? 'not_packaged' : 'probe_failed', packaged: !notPackaged, devices: [],
        message: String(error?.message || error) };
    }
  },
  /**
   * True when the Vulkan GPU is the Mali-G57 (the onn 13" Pro tablet). Text generation on it measured
   * about half the speed of the CPU (2.1 vs 4.5 tokens per second for a 4B Q4_0 model), so Automatic
   * leaves Vulkan out there. Other GPUs, other Mali models included, are not measured and keep the
   * normal order. Choosing Vulkan by hand still works.
   */
  async isSlowTextGpu(): Promise<boolean> {
    try {
      return (await this.runtimeStatus()).devices.filter(isVulkanGpu).some((d) => /mali[- ]?g57/i.test(`${d.name} ${d.description}`));
    } catch {
      return false;
    }
  },
  async isAvailable(): Promise<boolean> {
    try {
      return (await this.runtimeStatus()).status === 'ok';
    } catch {
      return false;
    }
  },
  async loadModel(path: string, opts: { gpuLayers: number; context?: number; threads?: number }): Promise<VulkanLoadResult> {
    const { gpuLayers, context = 4096, threads = 0 } = opts;
    if (activeSession) throw new Error('Cannot replace a model while generating');
    const result = await required().loadModel(path, gpuLayers, context, threads);
    // Older bridges resolved only the backend name; their layer count is unknown.
    return typeof result === 'string'
      ? { backend: result, requestedGpuLayers: gpuLayers, offloadedGpuLayers: -1, totalLayers: -1 }
      : result;
  },
  async activeBackend(): Promise<string> {
    return required().activeBackend();
  },
  async formatChat(messages: Array<{ role: string; content: string }>): Promise<string> {
    return required().formatChat(JSON.stringify(messages));
  },
  async tokenize(text: string): Promise<number[]> {
    return required().tokenize(text);
  },
  async generate(prompt: string, opts: { maxTokens: number; onToken: (text: string) => void; sampling?: VulkanSamplingSettings }): Promise<void> {
    const { maxTokens, onToken, sampling = {} } = opts;
    if (activeSession) throw new Error('Vulkan generation is already active');
    const module = required();
    const sessionId = String(++generationCounter);
    activeSession = sessionId;
    const subscriptions: Array<{ remove(): void }> = [];
    let finished = false;
    let reportedError: Error | null = null;
    try {
      // Listener registration can fail (for example during RN bridge teardown).
      // Always release the session lock, even if no native generation was started.
      const events = new NativeEventEmitter(NativeModules.AtlasVulkan);
      subscriptions.push(events.addListener('AtlasVulkanToken', (event: {sessionId: string; text: string}) => {
        if (finished || activeSession !== sessionId || event.sessionId !== sessionId || reportedError) return;
        try {
          onToken(event.text);
        } catch (error) {
          reportedError = error instanceof Error ? error : new Error(String(error));
          // Do not throw from a React Native event listener: cancel native work,
          // then surface the callback failure through the generation promise.
          void module.interrupt(sessionId).catch(() => {});
        }
      }));
      subscriptions.push(events.addListener('AtlasVulkanError', (event: {sessionId: string; text: string}) => {
        if (event.sessionId === sessionId) reportedError = new Error(event.text || 'Vulkan generation failed');
      }));
      await module.generate(prompt, maxTokens, sessionId, JSON.stringify(sampling));
      if (reportedError) throw reportedError;
    } finally {
      finished = true;
      for (const subscription of subscriptions) subscription.remove();
      if (activeSession === sessionId) activeSession = null;
    }
  },
  async interrupt(): Promise<void> {
    if (activeSession) await required().interrupt(activeSession);
  },
  async unload(): Promise<void> {
    if (activeSession) await this.interrupt();
    await required().unload();
  },
};
