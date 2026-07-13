import { Platform, NativeModules } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';
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
import { MODEL_RECOMMENDATIONS, RECOMMENDED_MODELS } from '../constants';
import { HTP_ENABLED } from '../config/featureFlags';
/**
 * QNN variant tiers — mirrors local-dream's chipsetModelSuffixes map exactly.
 * Source: https://github.com/xororz/local-dream — Model.kt getChipsetSuffix()
 *
 * - 8gen2: SM8550, SM8650, SM8735, SM8750, SM8845, SM8850
 * - 8gen1: SM8450, SM8475
 * - min:   any other SM-prefixed chip (fallback, same as local-dream)
 */
const FLAGSHIP_8GEN2 = new Set([8550, 8650, 8735, 8750, 8845, 8850]);
const FLAGSHIP_8GEN1 = new Set([8450, 8475]);
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
      available: total - used,
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
    // Find the appropriate recommendation tier
    const tier =
      MODEL_RECOMMENDATIONS.memoryToParams.find(
        t => totalRamGB >= t.minRam && totalRamGB < t.maxRam,
      ) || MODEL_RECOMMENDATIONS.memoryToParams[0];
    // Filter recommended models based on device capability
    const compatibleModels = RECOMMENDED_MODELS.filter(
      m => m.minRam <= totalRamGB,
    ).map(m => m.id);
    let warning: string | undefined;
    if (totalRamGB < 4) {
      warning =
        'Your device has limited memory. Only the smallest models will work well.';
    } else if (this.cachedDeviceInfo?.isEmulator) {
      warning = 'Running in emulator. Performance may be significantly slower.';
    }
    return {
      maxParameters: tier.maxParams,
      recommendedQuantization: tier.quantization,
      recommendedModels: compatibleModels,
      warning,
    };
  }
  canRunModel(
    parametersBillions: number,
    quantization: string = 'Q4_K_M',
  ): boolean {
    const availableMemoryGB = this.getAvailableMemoryGB();
    // Estimate model memory requirement
    // Q4_K_M uses ~0.5 bytes per parameter + overhead
    const bitsPerWeight = this.getQuantizationBits(quantization);
    const modelSizeGB = (parametersBillions * bitsPerWeight) / 8;
    // Need at least 1.5x the model size for safe operation
    const requiredMemory = modelSizeGB * 1.5;
    return availableMemoryGB >= requiredMemory;
  }
  estimateModelMemoryGB(
    parametersBillions: number,
    quantization: string = 'Q4_K_M',
  ): number {
    const bitsPerWeight = this.getQuantizationBits(quantization);
    return (parametersBillions * bitsPerWeight) / 8;
  }
  private getQuantizationBits(quantization: string): number {
    const bits: Record<string, number> = { Q2_K: 2.625, Q3_K_S: 3.4375, Q3_K_M: 3.4375, Q4_0: 4, Q4_K_S: 4.5, Q4_K_M: 4.5, Q5_K_S: 5.5, Q5_K_M: 5.5, Q6_K: 6.5, Q8_0: 8, F16: 16 };
    for (const [key, value] of Object.entries(bits)) {
      if (quantization.toUpperCase().includes(key)) return value;
    }
    return 4.5;
  }
  formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  }
  getModelTotalSize(model: { fileSize?: number; size?: number; mmProjFileSize?: number }): number {
    return (model.fileSize || model.size || 0) + (model.mmProjFileSize || 0);
  }
  formatModelSize(model: { fileSize?: number; size?: number; mmProjFileSize?: number }): string {
    return this.formatBytes(this.getModelTotalSize(model));
  }
  estimateModelRam(model: { fileSize?: number; size?: number; mmProjFileSize?: number }, multiplier = 1.5): number {
    return this.getModelTotalSize(model) * multiplier;
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
    if (Platform.OS !== 'ios') return false;
    const iosMajor = parseInt(String(Platform.Version), 10);
    if (Number.isNaN(iosMajor) || iosMajor < 26) return false;
    return this.getTotalMemoryGB() >= 7; // 8GB-class devices report ~7.4GB
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
    const multiplier = Platform.OS === 'ios' && !this.preferGpuForImageGen() ? 1.8 : 2.5;
    return this.estimateModelRam(model, multiplier);
  }
  formatModelRam(model: { fileSize?: number; size?: number; mmProjFileSize?: number }, multiplier = 1.5): string {
    return `~${(this.estimateModelRam(model, multiplier) / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  }
  private detectAppleChip(deviceId: string): SoCInfo['appleChip'] {
    const match = /iPhone(\d+)/.exec(deviceId);
    if (!match) return undefined;
    const major = Number.parseInt(match[1], 10);
    if (major >= 17) return 'A18';
    if (major >= 16) return 'A17Pro';
    if (major >= 15) return 'A16';
    if (major >= 14) return 'A15';
    if (major >= 13) return 'A14';
    return undefined;
  }
  async getSoCInfo(): Promise<SoCInfo> {
    if (this.cachedSoCInfo) return this.cachedSoCInfo;
    if (Platform.OS === 'ios') {
      const ramGB = this.getTotalMemoryGB();
      const appleChip =
        this.detectAppleChip(DeviceInfo.getDeviceId()) ??
        (ramGB >= 6 ? 'A15' : 'A14');
      this.cachedSoCInfo = { vendor: 'apple', hasNPU: true, appleChip };
      return this.cachedSoCInfo;
    }
    const hardware = await DeviceInfo.getHardware();
    const model = DeviceInfo.getModel();
    const hw = hardware.toLowerCase();
    let vendor: SoCVendor = 'unknown';
    if (hw.includes('qcom')) vendor = 'qualcomm';
    else if (model.startsWith('Pixel')) vendor = 'tensor';
    else if (hw.includes('mt') || hw.includes('mediatek')) vendor = 'mediatek';
    else if (hw.includes('exynos') || hw.includes('samsungexynos'))
      vendor = 'exynos';
    const qnnVariant =
      vendor === 'qualcomm' ? await this.getQnnVariantFromSoC() : undefined;
    this.cachedSoCInfo = {
      vendor,
      hasNPU: vendor === 'qualcomm' && !!qnnVariant,
      qnnVariant,
    };
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
    const base = socModel.split('-')[0].toUpperCase();
    // Must start with SM — matches local-dream's getChipsetSuffix fallback
    if (!base.startsWith('SM')) return undefined;
    const smMatch = /^SM(\d+)/.exec(base);
    if (!smMatch) return undefined;
    const num = Number.parseInt(smMatch[1], 10);
    if (FLAGSHIP_8GEN2.has(num)) return '8gen2';
    if (FLAGSHIP_8GEN1.has(num)) return '8gen1';
    return 'min';
  }
  private getIosImageRec(chip: SoCInfo['appleChip'], ramGB: number): ImageModelRecommendation {
    const coreml = 'coreml';
    if ((chip === 'A17Pro' || chip === 'A18') && ramGB >= 6)
      return { recommendedBackend: coreml, recommendedModels: ['sdxl', 'xl-base'], bannerText: 'All models supported \u2014 SDXL for best quality', compatibleBackends: [coreml] };
    if ((chip === 'A15' || chip === 'A16') && ramGB >= 6)
      return { recommendedBackend: coreml, recommendedModels: ['v1-5-palettized', '2-1-base-palettized'], bannerText: 'SD 1.5 or SD 2.1 Palettized recommended', compatibleBackends: [coreml] };
    if (ramGB < 4)
      return { recommendedBackend: coreml, recommendedModels: ['low ram'], bannerText: 'Low RAM models recommended for your device', compatibleBackends: [coreml] };
    return { recommendedBackend: coreml, recommendedModels: ['v1-5-palettized', '2-1-base-palettized'], bannerText: 'SD 1.5 or SD 2.1 Palettized recommended for your device', compatibleBackends: [coreml] };
  }
  private getQualcommImageRec(socInfo: SoCInfo): ImageModelRecommendation {
    let label: string;
    if (socInfo.qnnVariant === '8gen2') label = 'flagship';
    else if (socInfo.qnnVariant === '8gen1') label = '';
    else label = 'lightweight ';

    let suffix: string;
    if (socInfo.qnnVariant === '8gen2') suffix = 'NPU models for fastest inference';
    else if (socInfo.qnnVariant === '8gen1') suffix = 'NPU models supported';
    else suffix = 'lightweight NPU models recommended';
    return { recommendedBackend: 'qnn', qnnVariant: socInfo.qnnVariant, bannerText: `Snapdragon ${label}\u2014 ${suffix}`, compatibleBackends: ['qnn', 'mnn'] };
  }
  async getImageModelRecommendation(): Promise<ImageModelRecommendation> {
    if (this.cachedImageRecommendation) return this.cachedImageRecommendation;
    const socInfo = await this.getSoCInfo();
    const ramGB = this.getTotalMemoryGB();
    let rec: ImageModelRecommendation;
    if (Platform.OS === 'ios') {
      rec = this.getIosImageRec(socInfo.appleChip, ramGB);
    } else if (socInfo.vendor === 'qualcomm' && socInfo.hasNPU) {
      rec = this.getQualcommImageRec(socInfo);
    } else if (socInfo.vendor === 'qualcomm') {
      rec = {
        recommendedBackend: 'mnn',
        bannerText:
          'GPU models recommended \u2014 your Snapdragon doesn\u2019t support NPU acceleration',
        compatibleBackends: ['mnn'],
      };
    } else {
      rec = {
        recommendedBackend: 'mnn',
        bannerText:
          'GPU models recommended \u2014 NPU requires Snapdragon 888+',
        compatibleBackends: ['mnn'],
      };
    }
    if (ramGB < 4) {
      rec.warning = 'Low RAM \u2014 expect slower performance';
    }
    this.cachedImageRecommendation = rec;
    return rec;
  }
  getDeviceTier(): 'low' | 'medium' | 'high' | 'flagship' {
    const ramGB = this.getTotalMemoryGB();
    if (ramGB < 4) return 'low';
    if (ramGB < 6) return 'medium';
    if (ramGB < 8) return 'high';
    return 'flagship';
  }
  async getCpuCoreCount(): Promise<number> {
    if (Platform.OS !== 'android') return 4;
    try {
      const cpuinfo = await RNFS.readFile('/proc/cpuinfo', 'utf8');
      const matches = cpuinfo.match(/^processor\s*:/gm);
      return matches ? matches.length : 4;
    } catch { return 4; }
  }
  async getRecommendedThreadCount(): Promise<number> {
    const cores = await this.getCpuCoreCount();
    return cores <= 4 ? cores : Math.floor(cores * 0.8);
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
