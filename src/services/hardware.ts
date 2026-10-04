import { Platform, NativeModules } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
import logger from '../utils/logger';
import { readPerformanceCoreCount } from './cpuTopologyReader';
// Access NativeModules.LocalDreamModule dynamically (not destructured)
// so it can be mocked in tests after module import.
const getLocalDreamModule = () => NativeModules.LocalDreamModule;
import {
  DeviceInfo as DeviceInfoType,
  ModelRecommendation,
  SoCInfo,
  SoCVendor,
  ImageModelRecommendation,
} from '../types';
import { MODEL_RECOMMENDATIONS, RECOMMENDED_MODELS,
  formatFileSize,
} from '@offgrid/models';
import { HTP_ENABLED } from '../config/featureFlags';
import {
  appleChipForDevice,
  canRunParameterizedModel,
  classifyQnnVariant,
  detectAndroidSoCVendor,
  deviceTier,
  estimateParameterMemoryGB,
  estimateModelArtifactMemoryBytes,
  modelArtifactBytes,
  mobileImageRuntimeMemoryMultiplier,
  preferGpuForMobileImage,
  recommendMobileImage,
  recommendTextModels,
  recommendedInferenceThreadCount,
} from '@offgrid/models';
/**
 * QNN variant tiers — mirrors local-dream's chipsetModelSuffixes map exactly.
 * Source: https://github.com/xororz/local-dream — Model.kt getChipsetSuffix()
 *
 * - 8gen2: SM8550, SM8650, SM8735, SM8750, SM8845, SM8850
 * - 8gen1: SM8450, SM8475
 * - min:   any other SM-prefixed chip (fallback, same as local-dream)
 */
class HardwareService {
  private cachedDeviceInfo: DeviceInfoType | null = null;
  private cachedSoCInfo: SoCInfo | null = null;
  private cachedImageRecommendation: ImageModelRecommendation | null = null;
  private cachedOpenCLCapability: { supported: boolean; reason?: string } | null = null;
  async getDeviceInfo(): Promise<DeviceInfoType> {
    if (this.cachedDeviceInfo) {
      return this.cachedDeviceInfo;
    }
    const [
      totalMemory,
      usedMemory,
      deviceModel,
      systemName,
      systemVersion,
      isEmulator,
    ] = await Promise.all([
      DeviceInfo.getTotalMemory(),
      DeviceInfo.getUsedMemory(),
      DeviceInfo.getModel(),
      DeviceInfo.getSystemName(),
      DeviceInfo.getSystemVersion(),
      DeviceInfo.isEmulator(),
    ]);
    this.cachedDeviceInfo = {
      totalMemory,
      usedMemory,
      availableMemory: await this.computeAvailableBytes(totalMemory, usedMemory),
      deviceModel,
      systemName,
      systemVersion,
      isEmulator,
    };
    logger.log(`[WIRE-DEVICE] ${JSON.stringify({ platform: Platform.OS, ...this.cachedDeviceInfo })}`); // [WIRE] real device caps (drives onboarding recs + memory budget)
    return this.cachedDeviceInfo;
  }
  /**
   * Real free memory the system can hand out RIGHT NOW. On Android this reads
   * `MemAvailable` from /proc/meminfo (what the kernel will give without
   * swapping) — NOT `total − thisApp'sUsage`, which ignores every other app and
   * the OS and wildly over-reports on a loaded device (the cause of the OOM
   * freeze: the budget thought ~11GB was free when ~1.3GB was). Falls back to
   * total − used if /proc is unreadable or on iOS.
   */
  private async computeAvailableBytes(totalMemory: number, usedMemory: number): Promise<number> {
    // PREFER the real per-process headroom from DeviceMemoryModule — the only
    // number that means "the OS will actually give this process this much before
    // jetsam" (iOS os_proc_available_memory, which reflects the increased-memory
    // entitlement; Android ActivityManager.availMem). One uniform contract across
    // platforms. Fall back to Android /proc, then total−used (a known over-report,
    // last resort) so the budget degrades gracefully if the module is absent.
    const proc = await this.readProcessAvailableBytes();
    if (proc != null) return proc;
    const sys = await this.readSystemAvailableBytes();
    return sys != null ? sys : totalMemory - usedMemory;
  }
  /** Real per-process available memory (bytes) via the native module — same on
   *  iOS and Android. null when the module is unavailable. */
  private async readProcessAvailableBytes(): Promise<number | null> {
    const mod = NativeModules.DeviceMemoryModule;
    if (!mod?.getMemoryInfo) return null;
    try {
      const info = await mod.getMemoryInfo();
      logger.log(`[WIRE-RAM] ${JSON.stringify({ platform: Platform.OS, info })}`); // [WIRE] raw DeviceMemoryModule shape from-device
      const bytes = Number(info?.processAvailableBytes);
      return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
    } catch {
      return null;
    }
  }
  /**
   * The full per-process memory picture (MB) for diagnostics: what iOS will still let
   * this process allocate (available), its current footprint, and the derived process
   * LIMIT (available + footprint) — the number that explains a "not enough memory"
   * refusal on a high-RAM device (it's the OS cap on the app, not the physical RAM).
   * null when the native module is unavailable.
   */
  async getProcessMemory(): Promise<{ availableMB: number; footprintMB: number; limitMB: number } | null> {
    const mod = NativeModules.DeviceMemoryModule;
    if (!mod?.getMemoryInfo) return null;
    try {
      const info = await mod.getMemoryInfo();
      const availB = Number(info?.processAvailableBytes) || 0;
      const footB = Number(info?.footprintBytes) || 0;
      const MB = 1024 * 1024;
      return {
        availableMB: Math.round(availB / MB),
        footprintMB: Math.round(footB / MB),
        limitMB: Math.round((availB + footB) / MB),
      };
    } catch {
      return null;
    }
  }

  private async readSystemAvailableBytes(): Promise<number | null> {
    if (Platform.OS !== 'android') return null;
    try {
      const meminfo = await RNFS.readFile('/proc/meminfo', 'utf8');
      const match = /MemAvailable:\s+(\d+)\s*kB/.exec(meminfo);
      if (match) return Number.parseInt(match[1], 10) * 1024;
    } catch {
      /* /proc unreadable — fall back to the DeviceInfo estimate */
    }
    return null;
  }
  async refreshMemoryInfo(): Promise<DeviceInfoType> {
    // Force fresh fetch of all memory info
    const [totalMemory, usedMemory] = await Promise.all([
      DeviceInfo.getTotalMemory(),
      DeviceInfo.getUsedMemory(),
    ]);
    if (!this.cachedDeviceInfo) {
      await this.getDeviceInfo();
    }
    if (this.cachedDeviceInfo) {
      this.cachedDeviceInfo.totalMemory = totalMemory;
      this.cachedDeviceInfo.usedMemory = usedMemory;
      this.cachedDeviceInfo.availableMemory = await this.computeAvailableBytes(totalMemory, usedMemory);
    }
    return this.cachedDeviceInfo!;
  }
  /**
   * Get app-specific memory usage (more accurate for tracking model memory)
   * Note: This is system memory, native allocations may not be fully reflected
   */
  async getAppMemoryUsage(): Promise<{
    used: number;
    available: number;
    total: number;
  }> {
    const total = await DeviceInfo.getTotalMemory();
    const used = await DeviceInfo.getUsedMemory();
    return {
      used,
      // ONE owner for "how much can we still allocate". Was `total - used`: device-wide free RAM,
      // which on a 12GB iPhone read ~10.9GB while the process ceiling was ~6.3GB. The model-load gate
      // reads this figure, so an oversized model was approved and iOS killed the app. Android has no
      // per-process cap, which is why only iOS died. computeAvailableBytes already gets this right.
      available: await this.computeAvailableBytes(total, used),
      total,
    };
  }
  getTotalMemoryGB(): number {
    if (!this.cachedDeviceInfo) {
      DeviceInfo.getTotalMemory()
        .then(mem => {
          if (this.cachedDeviceInfo) {
            this.cachedDeviceInfo.totalMemory = mem;
          }
        })
        .catch(error =>
          console.warn('Failed to fetch total memory in background:', error),
        );
      return 4; // Safe default until cache is populated
    }
    return this.cachedDeviceInfo.totalMemory / (1024 * 1024 * 1024);
  }
  getAvailableMemoryGB(): number {
    if (!this.cachedDeviceInfo) {
      DeviceInfo.getTotalMemory()
        .then(mem => {
          if (this.cachedDeviceInfo) {
            this.cachedDeviceInfo.totalMemory = mem;
            this.cachedDeviceInfo.availableMemory =
              mem - (this.cachedDeviceInfo.usedMemory || 0);
          }
        })
        .catch(error =>
          console.warn(
            'Failed to fetch available memory in background:',
            error,
          ),
        );
      return 2; // Safe default until cache is populated
    }
    return this.cachedDeviceInfo.availableMemory / (1024 * 1024 * 1024);
  }
  getModelRecommendation(): ModelRecommendation {
    const totalRamGB = this.getTotalMemoryGB();
    return recommendTextModels({
      totalRamGB,
      isEmulator: this.cachedDeviceInfo?.isEmulator,
      tiers: MODEL_RECOMMENDATIONS.memoryToParams,
      models: RECOMMENDED_MODELS,
    });
  }
  canRunModel(
    parametersBillions: number,
    quantization: string = 'Q4_K_M',
  ): boolean {
    return canRunParameterizedModel({
      availableMemoryGB: this.getAvailableMemoryGB(),
      parametersBillions,
      quantization,
    });
  }
  estimateModelMemoryGB(
    parametersBillions: number,
    quantization: string = 'Q4_K_M',
  ): number {
    return estimateParameterMemoryGB(parametersBillions, quantization);
  }
  /** One byte formatter for every surface (shared). */
  formatBytes(bytes: number): string {
    return formatFileSize(bytes);
  }
  getModelTotalSize(model: { fileSize?: number; size?: number; mmProjFileSize?: number }): number {
    return modelArtifactBytes(model);
  }
  formatModelSize(model: { fileSize?: number; size?: number; mmProjFileSize?: number }): string {
    return this.formatBytes(this.getModelTotalSize(model));
  }
  estimateModelRam(model: { fileSize?: number; size?: number; mmProjFileSize?: number }, multiplier = 1.5): number {
    return estimateModelArtifactMemoryBytes(model, multiplier);
  }
  /**
   * Whether iOS Core ML image generation should run on the GPU (vs the Neural
   * Engine). On iOS 26 the ANE is degraded for these palettized diffusion models:
   * on devices with enough RAM (e.g. iPhone 15 Pro, 8GB) the ANE load fails
   * outright, so GPU is the only working path; on smaller devices (e.g. iPhone
   * 15, 6GB) the GPU's system-RAM buffers OOM, so the ANE — slower, but a far
   * smaller system-RAM footprint — is the only path that fits. Pre-26 iOS keeps
   * the ANE (fast + low memory there). Android uses a different backend entirely.
   */
  preferGpuForImageGen(): boolean {
    return preferGpuForMobileImage({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      platformVersion: Platform.Version,
      totalRamGB: this.getTotalMemoryGB(),
    });
  }

  /**
   * Image diffusion models hold a larger runtime working set than their file
   * size — UNet activations and VAE decode buffers. The multiplier tracks the
   * compute path: the GPU keeps buffers in system RAM (~2.5×), while the iOS
   * Neural Engine holds weights off-heap so its system-RAM footprint is far
   * smaller (~1.8×). Picking the multiplier from preferGpuForImageGen keeps the
   * residency estimate consistent with the path the model will actually load on,
   * so the gate doesn't refuse an ANE load that fits (nor admit a GPU load that
   * OOMs). Android (ONNX/QNN reserves accelerator memory up front) keeps 2.5×.
   */
  estimateImageModelRam(model: { fileSize?: number; size?: number; mmProjFileSize?: number }): number {
    const multiplier = mobileImageRuntimeMemoryMultiplier({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      preferGpu: this.preferGpuForImageGen(),
    });
    return this.estimateModelRam(model, multiplier);
  }
  formatModelRam(model: { fileSize?: number; size?: number; mmProjFileSize?: number }, multiplier = 1.5): string {
    return `~${(this.estimateModelRam(model, multiplier) / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  async getSoCInfo(): Promise<SoCInfo> {
    if (this.cachedSoCInfo) return this.cachedSoCInfo;
    if (Platform.OS === 'ios') {
      const ramGB = this.getTotalMemoryGB();
      const appleChip = appleChipForDevice({
        deviceId: DeviceInfo.getDeviceId(),
        totalRamGB: ramGB,
      });
      this.cachedSoCInfo = { vendor: 'apple', hasNPU: true, appleChip };
      return this.cachedSoCInfo;
    }
    const hardware = await DeviceInfo.getHardware();
    const model = DeviceInfo.getModel();
    const vendor: SoCVendor = detectAndroidSoCVendor({
      hardware,
      deviceModel: model,
    });
    const qnnVariant =
      vendor === 'qualcomm' ? await this.getQnnVariantFromSoC() : undefined;
    this.cachedSoCInfo = {
      vendor,
      hasNPU: vendor === 'qualcomm' && !!qnnVariant,
      qnnVariant,
    };
    logger.log(`[WIRE-DEVICE-SOC] ${JSON.stringify({ hardware, model, ...this.cachedSoCInfo })}`); // [WIRE] real SoC/NPU detection (drives qnn image-backend gate)
    return this.cachedSoCInfo;
  }
  private async getQnnVariantFromSoC(): Promise<
    '8gen2' | '8gen1' | 'min' | undefined
  > {
    const socModel = await this.fetchSoCModel();
    if (!socModel) return undefined;
    return this.classifySmNumber(socModel);
  }
  private async fetchSoCModel(): Promise<string> {
    try {
      const localDream = getLocalDreamModule();
      if (localDream?.getSoCModel) return await localDream.getSoCModel();
    } catch {
      /* native module unavailable */
    }
    return '';
  }
  private classifySmNumber(
    socModel: string,
  ): '8gen2' | '8gen1' | 'min' | undefined {
    return classifyQnnVariant(socModel);
  }
  async getImageModelRecommendation(): Promise<ImageModelRecommendation> {
    if (this.cachedImageRecommendation) return this.cachedImageRecommendation;
    const socInfo = await this.getSoCInfo();
    const ramGB = this.getTotalMemoryGB();
    this.cachedImageRecommendation = recommendMobileImage({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      totalRamGB: ramGB,
      soc: socInfo,
    });
    return this.cachedImageRecommendation;
  }
  getDeviceTier(): 'low' | 'medium' | 'high' | 'flagship' {
    return deviceTier(this.getTotalMemoryGB());
  }
  async getCpuCoreCount(): Promise<number> {
    if (Platform.OS !== 'android') return 4;
    try {
      const cpuinfo = await RNFS.readFile('/proc/cpuinfo', 'utf8');
      const matches = cpuinfo.match(/^processor\s*:/gm);
      return matches ? matches.length : 4;
    } catch { return 4; }
  }
  /** The cores worth running inference on. Cached for the process: CPU topology cannot change while
   *  the app runs, and this sits on the model-load path. */
  private performanceCores: number | null = null;
  async getPerformanceCoreCount(): Promise<number> {
    if (Platform.OS !== 'android') return 0; // no sysfs; the caller keeps its own rule
    if (this.performanceCores !== null) return this.performanceCores;
    const cores = await this.getCpuCoreCount();
    const count = await readPerformanceCoreCount(cores);
    logger.log(`[CPU-SM] performance cores=${count} of ${cores}`);
    this.performanceCores = count;
    return count;
  }
  async getRecommendedThreadCount(): Promise<number> {
    const cores = await this.getCpuCoreCount();
    // Android: thread the PERFORMANCE cluster and nothing else. The old rule was 80% of every core,
    // which on an 8-core phone spilled two threads onto efficiency cores and ran slower than using
    // four — the case this replaces. Below two the topology read told us nothing useful, so fall
    // through to the generic rule rather than crippling the engine on a single thread.
    const fast = Platform.OS === 'android'
      ? await this.getPerformanceCoreCount()
      : undefined;
    return recommendedInferenceThreadCount({
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      cpuCoreCount: cores,
      performanceCoreCount: fast,
    });
  }
  /**
   * The device's llama.rn hardware-acceleration options, composed ONCE from the same
   * probes the Inference-Backend settings use: NPU/HTP (Qualcomm Hexagon, gated by the
   * HTP feature flag) and GPU/OpenCL (Adreno/Mali). This is the single source for "can
   * this device go faster than CPU?", so the settings screen and the chat acceleration
   * tip agree instead of each re-deriving it.
   */
  async getAccelerationCapability(): Promise<{ hasNpu: boolean; hasGpu: boolean }> {
    if (Platform.OS !== 'android') return { hasNpu: false, hasGpu: false };
    const [soc, opencl] = await Promise.all([this.getSoCInfo(), this.getOpenCLCapability()]);
    return { hasNpu: HTP_ENABLED && soc.hasNPU, hasGpu: opencl.supported };
  }

  async getOpenCLCapability(): Promise<{ supported: boolean; reason?: string }> {
    if (this.cachedOpenCLCapability) return this.cachedOpenCLCapability;
    if (Platform.OS !== 'android') return { supported: false, reason: 'not_android' };
    try {
      const hardware = (await DeviceInfo.getHardware()).toLowerCase();
      // Support Qualcomm Adreno (qcom) and ARM Mali GPUs.
      // Avoid 'arm' alone — it matches the CPU architecture string (arm64-v8a), not the GPU vendor.
      const hasCompatibleGpu = hardware.includes('qcom') || hardware.includes('mali');
      if (!hasCompatibleGpu) return (this.cachedOpenCLCapability = { supported: false, reason: 'no_compatible_gpu' });
      return (this.cachedOpenCLCapability = { supported: true });
    } catch { return (this.cachedOpenCLCapability = { supported: false, reason: 'detection_failed' }); }
  }
}
export const hardwareService = new HardwareService();
