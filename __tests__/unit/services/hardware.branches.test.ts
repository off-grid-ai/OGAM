/**
 * HardwareService — additional branch coverage.
 *
 * Targets: getAvailableMemoryGB background fetch .then (cache populated),
 * estimateImageModelRam (2.5x), getCpuCoreCount (parse + non-android + catch),
 * getRecommendedThreadCount, and getOpenCLCapability (cache, non-android,
 * compatible/incompatible GPU, detection failure).
 */

import { Platform, NativeModules } from 'react-native';
import { hardwareService } from '../../../src/services/hardware';
import DeviceInfo from 'react-native-device-info';
import RNFS from 'react-native-fs';

const mockedDeviceInfo = DeviceInfo as jest.Mocked<typeof DeviceInfo>;
const mockedRNFS = RNFS as jest.Mocked<typeof RNFS>;

const resetCaches = () => {
  (hardwareService as any).cachedDeviceInfo = null;
  (hardwareService as any).cachedSoCInfo = null;
  (hardwareService as any).cachedImageRecommendation = null;
  (hardwareService as any).cachedOpenCLCapability = null;
};

describe('HardwareService — branch coverage', () => {
  const originalOS = Platform.OS;
  const originalVersion = Platform.Version;

  beforeEach(() => {
    jest.clearAllMocks();
    resetCaches();
  });

  /** Platform.Version is a non-writable getter under the RN jest mock, so set it
   *  via defineProperty rather than plain assignment (which silently no-ops). */
  const setIosVersion = (v: string) => {
    Object.defineProperty(Platform, 'Version', { configurable: true, writable: true, value: v });
  };

  afterEach(() => {
    Platform.OS = originalOS;
    setIosVersion(originalVersion as string);
    delete (NativeModules as any).LocalDreamModule;
  });

  /** Force hardwareService.getTotalMemoryGB() to a fixed value via the cache. */
  const setTotalRamGB = (gb: number) => {
    (hardwareService as any).cachedDeviceInfo = {
      totalMemory: gb * 1024 * 1024 * 1024,
      usedMemory: 0,
      availableMemory: gb * 1024 * 1024 * 1024,
    };
  };

  // ── getAvailableMemoryGB background fetch .then (lines 133-139) ───────────
  describe('getAvailableMemoryGB background fetch', () => {
    it('returns the 2GB default and updates cache in the .then callback', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(16 * 1024 * 1024 * 1024);

      const result = hardwareService.getAvailableMemoryGB();
      expect(result).toBe(2); // safe default until cache populated

      // Populate cache before the background promise resolves to exercise the
      // `if (this.cachedDeviceInfo)` true branch that sets totalMemory + availableMemory
      (hardwareService as any).cachedDeviceInfo = {
        totalMemory: 8 * 1024 * 1024 * 1024,
        usedMemory: 3 * 1024 * 1024 * 1024,
        availableMemory: 5 * 1024 * 1024 * 1024,
      };
      await new Promise(r => setTimeout(r, 10));

      const cache = (hardwareService as any).cachedDeviceInfo;
      expect(cache.totalMemory).toBe(16 * 1024 * 1024 * 1024);
      // availableMemory = mem - usedMemory
      expect(cache.availableMemory).toBe(16 * 1024 * 1024 * 1024 - 3 * 1024 * 1024 * 1024);
    });

    it('uses usedMemory||0 fallback when usedMemory is undefined', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(10 * 1024 * 1024 * 1024);
      hardwareService.getAvailableMemoryGB();
      (hardwareService as any).cachedDeviceInfo = {
        totalMemory: 4 * 1024 * 1024 * 1024,
        availableMemory: 2 * 1024 * 1024 * 1024,
        // usedMemory intentionally omitted → `|| 0`
      };
      await new Promise(r => setTimeout(r, 10));
      expect((hardwareService as any).cachedDeviceInfo.availableMemory).toBe(10 * 1024 * 1024 * 1024);
    });
  });

  // ── preferGpuForImageGen + estimateImageModelRam (compute-path aware) ──────
  describe('preferGpuForImageGen', () => {
    it('is true on iOS 26 with enough RAM (8GB-class → GPU works, ANE fails)', () => {
      Platform.OS = 'ios';
      setIosVersion('26.0');
      setTotalRamGB(8);
      expect(hardwareService.preferGpuForImageGen()).toBe(true);
    });

    it('is false on iOS 26 with low RAM (6GB → GPU OOMs, fall back to ANE)', () => {
      Platform.OS = 'ios';
      setIosVersion('26.0');
      setTotalRamGB(6);
      expect(hardwareService.preferGpuForImageGen()).toBe(false);
    });

    it('is false on iOS < 26 (ANE works well there)', () => {
      Platform.OS = 'ios';
      setIosVersion('18.0');
      setTotalRamGB(8);
      expect(hardwareService.preferGpuForImageGen()).toBe(false);
    });

    it('is false on Android', () => {
      Platform.OS = 'android';
      setTotalRamGB(12);
      expect(hardwareService.preferGpuForImageGen()).toBe(false);
    });
  });

  describe('estimateImageModelRam', () => {
    it('budgets 2.5x on Android (ONNX/QNN reserves accelerator memory)', () => {
      Platform.OS = 'android';
      expect(hardwareService.estimateImageModelRam({ fileSize: 2_000_000_000 })).toBe(5_000_000_000);
    });

    it('budgets 2.5x on the iOS GPU path (8GB / iOS 26)', () => {
      Platform.OS = 'ios';
      setIosVersion('26.0');
      setTotalRamGB(8);
      expect(hardwareService.estimateImageModelRam({ fileSize: 2_000_000_000 })).toBe(5_000_000_000);
    });

    it('budgets 1.8x on the iOS ANE path (6GB / iOS 26)', () => {
      Platform.OS = 'ios';
      setIosVersion('26.0');
      setTotalRamGB(6);
      expect(hardwareService.estimateImageModelRam({ fileSize: 2_000_000_000 })).toBe(3_600_000_000);
    });

    it('includes mmproj in the budget (Android 2.5x)', () => {
      Platform.OS = 'android';
      expect(
        hardwareService.estimateImageModelRam({ fileSize: 1_000_000_000, mmProjFileSize: 1_000_000_000 }),
      ).toBe(5_000_000_000);
    });
  });

  // ── getCpuCoreCount / getRecommendedThreadCount (lines 357-368) ───────────
  describe('getCpuCoreCount', () => {
    it('returns 4 on non-android without reading /proc', async () => {
      Platform.OS = 'ios';
      const count = await hardwareService.getCpuCoreCount();
      expect(count).toBe(4);
      expect(mockedRNFS.readFile).not.toHaveBeenCalled();
    });

    it('counts processor lines from /proc/cpuinfo on android', async () => {
      Platform.OS = 'android';
      mockedRNFS.readFile.mockResolvedValueOnce(
        'processor\t: 0\nmodel\nprocessor\t: 1\nprocessor\t: 2\n' as any,
      );
      expect(await hardwareService.getCpuCoreCount()).toBe(3);
    });

    it('falls back to 4 when /proc/cpuinfo has no processor lines (matches null)', async () => {
      Platform.OS = 'android';
      mockedRNFS.readFile.mockResolvedValueOnce('garbage with no proc lines' as any);
      expect(await hardwareService.getCpuCoreCount()).toBe(4);
    });

    it('falls back to 4 when reading /proc/cpuinfo throws', async () => {
      Platform.OS = 'android';
      mockedRNFS.readFile.mockRejectedValueOnce(new Error('proc unreadable'));
      expect(await hardwareService.getCpuCoreCount()).toBe(4);
    });
  });

  describe('getRecommendedThreadCount', () => {
    it('returns the core count when cores <= 4', async () => {
      Platform.OS = 'ios'; // → 4 cores
      expect(await hardwareService.getRecommendedThreadCount()).toBe(4);
    });

    it('returns floor(cores * 0.8) when cores > 4', async () => {
      Platform.OS = 'android';
      mockedRNFS.readFile.mockResolvedValueOnce(
        Array.from({ length: 8 }, (_, i) => `processor\t: ${i}`).join('\n') as any,
      );
      // 8 cores → floor(6.4) = 6
      expect(await hardwareService.getRecommendedThreadCount()).toBe(6);
    });
  });

  // ── getOpenCLCapability (lines 369-380) ───────────────────────────────────
  describe('getOpenCLCapability', () => {
    it('returns not_android on non-android', async () => {
      Platform.OS = 'ios';
      expect(await hardwareService.getOpenCLCapability()).toEqual({
        supported: false,
        reason: 'not_android',
      });
    });

    it('returns supported for qcom hardware and caches it', async () => {
      Platform.OS = 'android';
      mockedDeviceInfo.getHardware.mockResolvedValue('qcom-adreno');
      const first = await hardwareService.getOpenCLCapability();
      expect(first).toEqual({ supported: true });

      // Second call returns the cached object without re-reading hardware
      mockedDeviceInfo.getHardware.mockClear();
      const second = await hardwareService.getOpenCLCapability();
      expect(second).toBe(first);
      expect(mockedDeviceInfo.getHardware).not.toHaveBeenCalled();
    });

    it('returns supported for mali hardware', async () => {
      Platform.OS = 'android';
      mockedDeviceInfo.getHardware.mockResolvedValue('arm-mali-g78');
      expect(await hardwareService.getOpenCLCapability()).toEqual({ supported: true });
    });

    it('returns no_compatible_gpu for unsupported hardware', async () => {
      Platform.OS = 'android';
      mockedDeviceInfo.getHardware.mockResolvedValue('exynos-generic');
      expect(await hardwareService.getOpenCLCapability()).toEqual({
        supported: false,
        reason: 'no_compatible_gpu',
      });
    });

    it('returns detection_failed when getHardware throws', async () => {
      Platform.OS = 'android';
      mockedDeviceInfo.getHardware.mockRejectedValue(new Error('hw error'));
      expect(await hardwareService.getOpenCLCapability()).toEqual({
        supported: false,
        reason: 'detection_failed',
      });
    });
  });

  // ── readSystemAvailableBytes via computeAvailableBytes (lines 72-82) ──────
  describe('computeAvailableBytes / readSystemAvailableBytes', () => {
    const setupBase = () => {
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(3 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
    };

    it('reads MemAvailable from /proc/meminfo on android', async () => {
      Platform.OS = 'android';
      setupBase();
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedRNFS.readFile.mockResolvedValue('MemTotal: 1 kB\nMemAvailable:    2097152 kB\n' as any);

      const info = await hardwareService.getDeviceInfo();
      // 2097152 kB * 1024 = 2 GB
      expect(info.availableMemory).toBe(2097152 * 1024);
    });

    it('falls back to total-used when /proc/meminfo is unreadable', async () => {
      Platform.OS = 'android';
      setupBase();
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedRNFS.readFile.mockRejectedValue(new Error('no proc'));

      const info = await hardwareService.getDeviceInfo();
      expect(info.availableMemory).toBe(8 * 1024 * 1024 * 1024 - 3 * 1024 * 1024 * 1024);
    });

    it('falls back to total-used when MemAvailable line is absent', async () => {
      Platform.OS = 'android';
      setupBase();
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedRNFS.readFile.mockResolvedValue('MemTotal: 100 kB\n' as any);

      const info = await hardwareService.getDeviceInfo();
      expect(info.availableMemory).toBe(8 * 1024 * 1024 * 1024 - 3 * 1024 * 1024 * 1024);
    });
  });
});
