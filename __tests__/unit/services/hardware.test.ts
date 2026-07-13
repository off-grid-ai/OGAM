/**
 * HardwareService Unit Tests
 *
 * Tests for device info, memory calculations, model recommendations, and formatting.
 * Priority: P0 (Critical) - Device capability detection drives model selection.
 */

import { Platform, NativeModules } from 'react-native';
import { hardwareService } from '../../../src/services/hardware';
import DeviceInfo from 'react-native-device-info';

const mockedDeviceInfo = DeviceInfo as jest.Mocked<typeof DeviceInfo>;

describe('HardwareService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset cached device info between tests
    (hardwareService as any).cachedDeviceInfo = null;
    (hardwareService as any).cachedSoCInfo = null;
    (hardwareService as any).cachedImageRecommendation = null;
  });

  // ========================================================================
  // getDeviceInfo
  // ========================================================================
  describe('getDeviceInfo', () => {
    it('returns complete device info object', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Pixel 7');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);

      const info = await hardwareService.getDeviceInfo();

      expect(info.totalMemory).toBe(8 * 1024 * 1024 * 1024);
      expect(info.usedMemory).toBe(4 * 1024 * 1024 * 1024);
      expect(info.availableMemory).toBe(4 * 1024 * 1024 * 1024);
      expect(info.deviceModel).toBe('Pixel 7');
      expect(info.systemName).toBe('Android');
      expect(info.systemVersion).toBe('14');
      expect(info.isEmulator).toBe(false);
    });

    it('calculates availableMemory as total - used', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(
        12 * 1024 * 1024 * 1024,
      );
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(5 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);

      const info = await hardwareService.getDeviceInfo();

      expect(info.availableMemory).toBe(7 * 1024 * 1024 * 1024);
    });

    it('caches result and does not re-fetch', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);

      await hardwareService.getDeviceInfo();
      await hardwareService.getDeviceInfo();

      // Should only be called once due to caching
      expect(mockedDeviceInfo.getTotalMemory).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // refreshMemoryInfo
  // ========================================================================
  describe('refreshMemoryInfo', () => {
    it('updates memory fields in cached info', async () => {
      // First, populate the cache
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      // Now refresh with different memory values
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(6 * 1024 * 1024 * 1024);

      const refreshed = await hardwareService.refreshMemoryInfo();

      expect(refreshed.usedMemory).toBe(6 * 1024 * 1024 * 1024);
      expect(refreshed.availableMemory).toBe(2 * 1024 * 1024 * 1024);
    });

    it('creates cache if empty before refreshing', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(3 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);

      const info = await hardwareService.refreshMemoryInfo();

      expect(info).toBeDefined();
      expect(info.totalMemory).toBe(8 * 1024 * 1024 * 1024);
    });

    it('preserves non-memory fields (deviceModel, etc.)', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Galaxy S24');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      // Refresh memory
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(5 * 1024 * 1024 * 1024);
      const refreshed = await hardwareService.refreshMemoryInfo();

      expect(refreshed.deviceModel).toBe('Galaxy S24');
    });
  });

  // ========================================================================
  // getAppMemoryUsage
  // ========================================================================
  describe('getAppMemoryUsage', () => {
    it('returns used, available, and total memory', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(3 * 1024 * 1024 * 1024);

      const usage = await hardwareService.getAppMemoryUsage();

      expect(usage.total).toBe(8 * 1024 * 1024 * 1024);
      expect(usage.used).toBe(3 * 1024 * 1024 * 1024);
      expect(usage.available).toBe(5 * 1024 * 1024 * 1024);
    });
  });

  // ========================================================================
  // getTotalMemoryGB
  // ========================================================================
  describe('getTotalMemoryGB', () => {
    it('returns 4 when no cached info', () => {
      expect(hardwareService.getTotalMemoryGB()).toBe(4);
    });

    it('returns correct GB from cached total memory', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      expect(hardwareService.getTotalMemoryGB()).toBe(8);
    });

    it('handles 16GB device correctly', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(
        16 * 1024 * 1024 * 1024,
      );
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(4 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      expect(hardwareService.getTotalMemoryGB()).toBe(16);
    });
  });

  // ========================================================================
  // getAvailableMemoryGB
  // ========================================================================
  describe('getAvailableMemoryGB', () => {
    it('returns 2 when no cached info', () => {
      expect(hardwareService.getAvailableMemoryGB()).toBe(2);
    });

    it('returns correct GB from cached available memory', async () => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();

      expect(hardwareService.getAvailableMemoryGB()).toBe(6);
    });
  });

  // ========================================================================
  // getModelRecommendation
  // ========================================================================
  describe('getModelRecommendation', () => {
    const setupWithMemory = async (totalGB: number, isEmulator = false) => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(
        totalGB * 1024 * 1024 * 1024,
      );
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(isEmulator);
      await hardwareService.getDeviceInfo();
    };

    it('returns recommendation for 3GB device', async () => {
      await setupWithMemory(3);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.maxParameters).toBe(1.5);
      expect(rec.recommendedQuantization).toBe('Q4_K_M');
    });

    it('returns recommendation for 8GB device', async () => {
      await setupWithMemory(8);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.maxParameters).toBe(8);
    });

    it('returns recommendation for 16GB device', async () => {
      await setupWithMemory(16);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.maxParameters).toBe(30);
    });

    it('adds low-memory warning for devices under 4GB', async () => {
      await setupWithMemory(3.5);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.warning).toContain('limited memory');
    });

    it('adds emulator warning on emulators', async () => {
      await setupWithMemory(8, true);

      const rec = hardwareService.getModelRecommendation();

      expect(rec.warning).toContain('emulator');
    });

    it('returns no warning for normal device with sufficient memory', async () => {
      await setupWithMemory(8);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.warning).toBeUndefined();
    });

    it('returns compatible models list', async () => {
      await setupWithMemory(8);
      const rec = hardwareService.getModelRecommendation();

      expect(rec.recommendedModels).toBeDefined();
      expect(Array.isArray(rec.recommendedModels)).toBe(true);
    });
  });

  // ========================================================================
  // canRunModel
  // ========================================================================
  describe('canRunModel', () => {
    const setupWithAvailableMemory = async (
      totalGB: number,
      usedGB: number,
    ) => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(
        totalGB * 1024 * 1024 * 1024,
      );
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(
        usedGB * 1024 * 1024 * 1024,
      );
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();
    };

    it('returns true when sufficient memory available', async () => {
      await setupWithAvailableMemory(16, 4); // 12GB available
      // 7B Q4_K_M = 7 * 4.5 / 8 = ~3.94GB, needs 3.94 * 1.5 = ~5.9GB
      expect(hardwareService.canRunModel(7, 'Q4_K_M')).toBe(true);
    });

    it('returns false when insufficient memory', async () => {
      await setupWithAvailableMemory(4, 3); // 1GB available
      // 7B Q4_K_M needs ~5.9GB
      expect(hardwareService.canRunModel(7, 'Q4_K_M')).toBe(false);
    });

    it('uses correct quantization bits for calculation', async () => {
      await setupWithAvailableMemory(16, 4); // 12GB available
      // 13B Q8_0 = 13 * 8 / 8 = 13GB, needs 13 * 1.5 = 19.5GB
      expect(hardwareService.canRunModel(13, 'Q8_0')).toBe(false);
    });

    it('defaults to Q4_K_M when no quantization specified', async () => {
      await setupWithAvailableMemory(16, 4); // 12GB available
      // 7B Q4_K_M default = 7 * 4.5 / 8 ~ 3.94GB, * 1.5 ~ 5.9GB -> true
      expect(hardwareService.canRunModel(7)).toBe(true);
    });

    it('returns false for very large models', async () => {
      await setupWithAvailableMemory(8, 4); // 4GB available
      // 70B Q4_K_M = 70 * 4.5 / 8 = 39.375GB, needs 59GB
      expect(hardwareService.canRunModel(70, 'Q4_K_M')).toBe(false);
    });

    it('handles small models on low memory', async () => {
      await setupWithAvailableMemory(4, 2); // 2GB available
      // 1B Q4_K_M = 1 * 4.5 / 8 = 0.5625GB, needs 0.84GB -> true
      expect(hardwareService.canRunModel(1, 'Q4_K_M')).toBe(true);
    });
  });

  // ========================================================================
  // estimateModelMemoryGB
  // ========================================================================
  describe('estimateModelMemoryGB', () => {
    it('estimates 7B Q4_K_M correctly', () => {
      // 7 * 4.5 / 8 = 3.9375
      expect(hardwareService.estimateModelMemoryGB(7, 'Q4_K_M')).toBeCloseTo(
        3.9375,
      );
    });

    it('estimates 13B Q8_0 correctly', () => {
      // 13 * 8 / 8 = 13
      expect(hardwareService.estimateModelMemoryGB(13, 'Q8_0')).toBe(13);
    });

    it('estimates 3B F16 correctly', () => {
      // 3 * 16 / 8 = 6
      expect(hardwareService.estimateModelMemoryGB(3, 'F16')).toBe(6);
    });

    it('uses 2.625 bits for Q2_K', () => {
      // 7 * 2.625 / 8 = 2.296875
      expect(hardwareService.estimateModelMemoryGB(7, 'Q2_K')).toBeCloseTo(
        2.296875,
      );
    });

    it('returns default 4.5 bits for unknown quantization', () => {
      // 7 * 4.5 / 8 = 3.9375
      expect(hardwareService.estimateModelMemoryGB(7, 'UNKNOWN')).toBeCloseTo(
        3.9375,
      );
    });

    it('handles case-insensitive quantization strings', () => {
      // q4_k_m should match Q4_K_M
      expect(hardwareService.estimateModelMemoryGB(7, 'q4_k_m')).toBeCloseTo(
        3.9375,
      );
    });

    it('estimates Q3_K_S correctly', () => {
      // 7 * 3.4375 / 8 = 3.0078125
      expect(hardwareService.estimateModelMemoryGB(7, 'Q3_K_S')).toBeCloseTo(
        3.0078125,
      );
    });

    it('estimates Q5_K_S correctly', () => {
      // 7 * 5.5 / 8 = 4.8125
      expect(hardwareService.estimateModelMemoryGB(7, 'Q5_K_S')).toBeCloseTo(
        4.8125,
      );
    });

    it('estimates Q6_K correctly', () => {
      // 7 * 6.5 / 8 = 5.6875
      expect(hardwareService.estimateModelMemoryGB(7, 'Q6_K')).toBeCloseTo(
        5.6875,
      );
    });

    it('estimates Q4_0 correctly', () => {
      // 7 * 4 / 8 = 3.5
      expect(hardwareService.estimateModelMemoryGB(7, 'Q4_0')).toBe(3.5);
    });
  });

  // ========================================================================
  // formatBytes
  // ========================================================================
  describe('formatBytes', () => {
    it('formats 0 as "0 B"', () => {
      expect(hardwareService.formatBytes(0)).toBe('0 B');
    });

    it('formats bytes correctly', () => {
      expect(hardwareService.formatBytes(500)).toBe('500.00 B');
    });

    it('formats kilobytes correctly', () => {
      expect(hardwareService.formatBytes(2048)).toBe('2.00 KB');
    });

    it('formats megabytes correctly', () => {
      expect(hardwareService.formatBytes(5 * 1024 * 1024)).toBe('5.00 MB');
    });

    it('formats gigabytes correctly', () => {
      expect(hardwareService.formatBytes(4 * 1024 * 1024 * 1024)).toBe(
        '4.00 GB',
      );
    });

    it('formats terabytes correctly', () => {
      expect(hardwareService.formatBytes(2 * 1024 * 1024 * 1024 * 1024)).toBe(
        '2.00 TB',
      );
    });
  });

  // ========================================================================
  // getModelTotalSize
  // ========================================================================
  describe('getModelTotalSize', () => {
    it('returns fileSize for text-only model', () => {
      expect(hardwareService.getModelTotalSize({ fileSize: 4000000000 })).toBe(
        4000000000,
      );
    });

    it('combines fileSize and mmProjFileSize for vision model', () => {
      expect(
        hardwareService.getModelTotalSize({
          fileSize: 4000000000,
          mmProjFileSize: 500000000,
        }),
      ).toBe(4500000000);
    });

    it('returns 0 when no size fields are present', () => {
      expect(hardwareService.getModelTotalSize({})).toBe(0);
    });

    it('uses size field as fallback for fileSize', () => {
      expect(hardwareService.getModelTotalSize({ size: 3000000000 })).toBe(
        3000000000,
      );
    });

    it('prefers fileSize over size', () => {
      expect(
        hardwareService.getModelTotalSize({
          fileSize: 4000000000,
          size: 3000000000,
        }),
      ).toBe(4000000000);
    });
  });

  // ========================================================================
  // formatModelSize
  // ========================================================================
  describe('formatModelSize', () => {
    it('formats model size including mmproj', () => {
      const result = hardwareService.formatModelSize({
        fileSize: 4 * 1024 * 1024 * 1024,
        mmProjFileSize: 500 * 1024 * 1024,
      });
      // 4.5 GB
      expect(result).toContain('GB');
    });

    it('formats model with only fileSize', () => {
      const result = hardwareService.formatModelSize({
        fileSize: 2 * 1024 * 1024 * 1024,
      });
      expect(result).toBe('2.00 GB');
    });

    it('returns "0 B" for empty model', () => {
      expect(hardwareService.formatModelSize({})).toBe('0 B');
    });
  });

  // ========================================================================
  // estimateModelRam
  // ========================================================================
  describe('estimateModelRam', () => {
    it('returns total size * 1.5 by default', () => {
      const ram = hardwareService.estimateModelRam({ fileSize: 4000000000 });
      expect(ram).toBe(6000000000);
    });

    it('accepts custom multiplier', () => {
      const ram = hardwareService.estimateModelRam(
        { fileSize: 4000000000 },
        2.0,
      );
      expect(ram).toBe(8000000000);
    });

    it('includes mmproj in ram estimate', () => {
      const ram = hardwareService.estimateModelRam({
        fileSize: 4000000000,
        mmProjFileSize: 500000000,
      });
      expect(ram).toBe(4500000000 * 1.5);
    });
  });

  // ========================================================================
  // formatModelRam
  // ========================================================================
  describe('formatModelRam', () => {
    it('formats estimated RAM usage', () => {
      const result = hardwareService.formatModelRam({
        fileSize: 4 * 1024 * 1024 * 1024,
      });
      // 4GB * 1.5 = 6GB
      expect(result).toBe('~6.0 GB');
    });

    it('formats with custom multiplier', () => {
      const result = hardwareService.formatModelRam(
        {
          fileSize: 4 * 1024 * 1024 * 1024,
        },
        2.0,
      );
      // 4GB * 2.0 = 8GB
      expect(result).toBe('~8.0 GB');
    });
  });

  // ========================================================================
  // getDeviceTier
  // ========================================================================
  describe('getDeviceTier', () => {
    const setupWithTotalMemory = async (totalGB: number) => {
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(
        totalGB * 1024 * 1024 * 1024,
      );
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();
    };

    it('returns "low" for under 4GB', async () => {
      await setupWithTotalMemory(3);
      expect(hardwareService.getDeviceTier()).toBe('low');
    });

    it('returns "medium" for 4-6GB', async () => {
      await setupWithTotalMemory(5);
      expect(hardwareService.getDeviceTier()).toBe('medium');
    });

    it('returns "high" for 6-8GB', async () => {
      await setupWithTotalMemory(7);
      expect(hardwareService.getDeviceTier()).toBe('high');
    });

    it('returns "flagship" for 8GB+', async () => {
      await setupWithTotalMemory(12);
      expect(hardwareService.getDeviceTier()).toBe('flagship');
    });

    it('returns "medium" for default (no cached info)', () => {
      // Default getTotalMemoryGB returns 4, which is "medium"
      expect(hardwareService.getDeviceTier()).toBe('medium');
    });

    it('returns "flagship" for exactly 8GB', async () => {
      await setupWithTotalMemory(8);
      expect(hardwareService.getDeviceTier()).toBe('flagship');
    });

    it('returns "medium" for exactly 4GB', async () => {
      await setupWithTotalMemory(4);
      expect(hardwareService.getDeviceTier()).toBe('medium');
    });

    it('returns "high" for exactly 6GB', async () => {
      await setupWithTotalMemory(6);
      expect(hardwareService.getDeviceTier()).toBe('high');
    });
  });

  // ========================================================================
  // getSoCInfo
  // ========================================================================
  describe('getSoCInfo', () => {
    const setupDevice = async (opts: {
      totalGB: number;
      model?: string;
      hardware?: string;
      platform?: typeof Platform.OS;
      deviceId?: string;
    }) => {
      if (opts.platform) Platform.OS = opts.platform;
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(
        opts.totalGB * 1024 * 1024 * 1024,
      );
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue(opts.model ?? 'Test');
      mockedDeviceInfo.getSystemName.mockReturnValue(
        opts.platform === 'ios' ? 'iOS' : 'Android',
      );
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      if (opts.deviceId) {
        mockedDeviceInfo.getDeviceId.mockReturnValue(opts.deviceId);
      }
      if (opts.hardware) {
        mockedDeviceInfo.getHardware.mockResolvedValue(opts.hardware);
      }
      await hardwareService.getDeviceInfo();
    };

    const originalOS = Platform.OS;
    afterEach(() => {
      Platform.OS = originalOS;
    });

    describe('iOS', () => {
      it('detects A18 chip for iPhone17,x', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'ios',
          deviceId: 'iPhone17,3',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.vendor).toBe('apple');
        expect(soc.hasNPU).toBe(true);
        expect(soc.appleChip).toBe('A18');
      });

      it('detects A17Pro chip for iPhone16,x', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'ios',
          deviceId: 'iPhone16,2',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.appleChip).toBe('A17Pro');
      });

      it('detects A16 chip for iPhone15,x', async () => {
        await setupDevice({
          totalGB: 6,
          platform: 'ios',
          deviceId: 'iPhone15,3',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.appleChip).toBe('A16');
      });

      it('detects A15 chip for iPhone14,x', async () => {
        await setupDevice({
          totalGB: 6,
          platform: 'ios',
          deviceId: 'iPhone14,5',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.appleChip).toBe('A15');
      });

      it('detects A14 chip for iPhone13,x', async () => {
        await setupDevice({
          totalGB: 4,
          platform: 'ios',
          deviceId: 'iPhone13,1',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.appleChip).toBe('A14');
      });

      it('falls back to RAM-based chip estimate for unknown device ID', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'ios',
          deviceId: 'iPad14,1',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.vendor).toBe('apple');
        expect(soc.appleChip).toBe('A15'); // 8GB >= 6 → A15 fallback
      });

      it('falls back to A14 for low-RAM unknown device', async () => {
        await setupDevice({
          totalGB: 3,
          platform: 'ios',
          deviceId: 'iPad10,1',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.appleChip).toBe('A14'); // 3GB < 6 → A14 fallback
      });
    });

    describe('Android', () => {
      it('detects Qualcomm from hardware string', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'android',
          hardware: 'qcom',
          model: 'Samsung Galaxy S24',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.vendor).toBe('qualcomm');
        // hasNPU depends on RAM heuristic (no native module) — 8GB → min variant → true
      });

      it('returns undefined qnnVariant when native module unavailable (no RAM heuristic)', async () => {
        await setupDevice({
          totalGB: 12,
          platform: 'android',
          hardware: 'qcom',
          model: 'Test',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.qnnVariant).toBeUndefined();
        expect(soc.hasNPU).toBe(false);
      });

      it('returns hasNPU false for Qualcomm without native module (any RAM)', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'android',
          hardware: 'qcom',
          model: 'Test',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.qnnVariant).toBeUndefined();
        expect(soc.hasNPU).toBe(false);
      });

      it('detects Tensor for Pixel devices', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'android',
          hardware: 'unknown-hw',
          model: 'Pixel 8 Pro',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.vendor).toBe('tensor');
        expect(soc.hasNPU).toBe(false);
      });

      it('detects MediaTek from hardware string', async () => {
        await setupDevice({
          totalGB: 6,
          platform: 'android',
          hardware: 'mt6789',
          model: 'Test',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.vendor).toBe('mediatek');
      });

      it('detects Exynos from hardware string', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'android',
          hardware: 'samsungexynos2200',
          model: 'Test',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.vendor).toBe('exynos');
      });

      it('returns unknown vendor for unrecognized hardware', async () => {
        await setupDevice({
          totalGB: 6,
          platform: 'android',
          hardware: 'something-else',
          model: 'Generic Phone',
        });
        const soc = await hardwareService.getSoCInfo();
        expect(soc.vendor).toBe('unknown');
        expect(soc.hasNPU).toBe(false);
      });
    });

    describe('getQnnVariantFromSoC range-based detection', () => {
      const setupQualcommWithSoC = async (socModel: string) => {
        Platform.OS = 'android' as typeof Platform.OS;
        NativeModules.LocalDreamModule = {
          getSoCModel: jest.fn().mockResolvedValue(socModel),
        };
        mockedDeviceInfo.getTotalMemory.mockResolvedValue(
          8 * 1024 * 1024 * 1024,
        );
        mockedDeviceInfo.getUsedMemory.mockResolvedValue(
          2 * 1024 * 1024 * 1024,
        );
        mockedDeviceInfo.getModel.mockReturnValue('Test');
        mockedDeviceInfo.getSystemName.mockReturnValue('Android');
        mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
        mockedDeviceInfo.isEmulator.mockResolvedValue(false);
        mockedDeviceInfo.getHardware.mockResolvedValue('qcom');
        await hardwareService.getDeviceInfo();
      };

      afterEach(() => {
        Platform.OS = originalOS;
        delete NativeModules.LocalDreamModule;
      });

      it.each([
        ['SM8550-AB', '8gen2', 'Snapdragon 8 Gen 2'],
        ['SM8650-AC', '8gen2', 'Snapdragon 8 Gen 3'],
        ['SM8735-AB', '8gen2', 'SM8735 flagship variant'],
        ['SM8750-AB', '8gen2', 'Snapdragon 8 Elite'],
        ['SM8845-AB', '8gen2', 'SM8845 flagship variant'],
        ['SM8850-AB', '8gen2', 'Snapdragon 8 Elite Gen 5'],
        ['SM8450-AB', '8gen1', 'Snapdragon 8 Gen 1'],
        ['SM8475-AB', '8gen1', 'Snapdragon 8+ Gen 1'],
        ['SM8635-AB', 'min', 'Snapdragon 8s Gen 3'],
        ['SM8535-AB', 'min', 'Snapdragon 8s Gen 2'],
        ['SM8350-AC', 'min', 'Snapdragon 888'],
        ['SM8250-AB', 'min', 'Snapdragon 870'],
        ['SM7450-AB', 'min', 'Snapdragon 7 Gen 1'],
        ['SM7475-AB', 'min', 'Snapdragon 7+ Gen 2'],
        ['SM7550-AB', 'min', 'Snapdragon 7 Gen 3'],
        ['SM7675-AB', 'min', 'Snapdragon 7+ Gen 3'],
        ['SM7225-AB', 'min', 'Snapdragon 750G'],
        ['SM6375-AB', 'min', 'Snapdragon 695'],
      ] as const)(
        'returns %s variant for %s (%s)',
        async (socModel, expected, _desc) => {
          await setupQualcommWithSoC(socModel);
          const soc = await hardwareService.getSoCInfo();
          expect(soc.qnnVariant).toBe(expected);
          expect(soc.hasNPU).toBe(true);
        },
      );
    });

    it('caches SoC info after first call', async () => {
      await setupDevice({
        totalGB: 8,
        platform: 'android',
        hardware: 'qcom',
        model: 'Test',
      });
      const first = await hardwareService.getSoCInfo();
      const second = await hardwareService.getSoCInfo();
      expect(first).toBe(second); // same reference
      expect(mockedDeviceInfo.getHardware).toHaveBeenCalledTimes(1);
    });
  });

  // ========================================================================
  // getImageModelRecommendation
  // ========================================================================
  describe('getImageModelRecommendation', () => {
    const setupDevice = async (opts: {
      totalGB: number;
      platform: typeof Platform.OS;
      hardware?: string;
      model?: string;
      deviceId?: string;
    }) => {
      Platform.OS = opts.platform;
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(
        opts.totalGB * 1024 * 1024 * 1024,
      );
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue(opts.model ?? 'Test');
      mockedDeviceInfo.getSystemName.mockReturnValue(
        opts.platform === 'ios' ? 'iOS' : 'Android',
      );
      mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      if (opts.deviceId)
        mockedDeviceInfo.getDeviceId.mockReturnValue(opts.deviceId);
      if (opts.hardware)
        mockedDeviceInfo.getHardware.mockResolvedValue(opts.hardware);
      await hardwareService.getDeviceInfo();
    };

    const originalOS = Platform.OS;
    afterEach(() => {
      Platform.OS = originalOS;
      delete NativeModules.LocalDreamModule;
    });

    describe('iOS recommendations', () => {
      it('recommends SDXL for high-end devices (A17Pro+, 6GB+)', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'ios',
          deviceId: 'iPhone16,2',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('coreml');
        expect(rec.recommendedModels).toEqual(
          expect.arrayContaining(['sdxl', 'xl-base']),
        );
        expect(rec.bannerText).toContain('SDXL');
      });

      it('recommends SD 1.5/2.1 palettized for mid-range (A15/A16, 6GB+)', async () => {
        await setupDevice({
          totalGB: 6,
          platform: 'ios',
          deviceId: 'iPhone15,2',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('coreml');
        expect(rec.recommendedModels).toEqual(
          expect.arrayContaining(['v1-5-palettized', '2-1-base-palettized']),
        );
        expect(rec.bannerText).toContain('Palettized');
      });

      it('recommends SD 1.5 palettized for mid-range (4GB+)', async () => {
        await setupDevice({
          totalGB: 4,
          platform: 'ios',
          deviceId: 'iPhone13,1',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('coreml');
        expect(rec.recommendedModels).toEqual(['v1-5-palettized', '2-1-base-palettized']);
      });

      it('recommends Low RAM models for <4GB devices', async () => {
        await setupDevice({
          totalGB: 3.7,
          platform: 'ios',
          deviceId: 'iPhone11,2',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('coreml');
        expect(rec.recommendedModels).toEqual(['low ram']);
        expect(rec.bannerText).toContain('Low RAM');
      });

      it('always includes coreml in compatible backends on iOS', async () => {
        await setupDevice({
          totalGB: 6,
          platform: 'ios',
          deviceId: 'iPhone15,2',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.compatibleBackends).toContain('coreml');
      });
    });

    describe('Android Qualcomm recommendations', () => {
      it('recommends QNN for Qualcomm devices with known SoC', async () => {
        Platform.OS = 'android' as typeof Platform.OS;
        NativeModules.LocalDreamModule = {
          getSoCModel: jest.fn().mockResolvedValue('SM8550-AB'),
        };
        mockedDeviceInfo.getTotalMemory.mockResolvedValue(
          12 * 1024 * 1024 * 1024,
        );
        mockedDeviceInfo.getUsedMemory.mockResolvedValue(
          2 * 1024 * 1024 * 1024,
        );
        mockedDeviceInfo.getModel.mockReturnValue('Test');
        mockedDeviceInfo.getSystemName.mockReturnValue('Android');
        mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
        mockedDeviceInfo.isEmulator.mockResolvedValue(false);
        mockedDeviceInfo.getHardware.mockResolvedValue('qcom');
        await hardwareService.getDeviceInfo();
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('qnn');
        expect(rec.qnnVariant).toBe('8gen2');
        expect(rec.compatibleBackends).toEqual(
          expect.arrayContaining(['qnn', 'mnn']),
        );
      });

      it('recommends MNN for Qualcomm without native module (cannot determine SoC)', async () => {
        await setupDevice({
          totalGB: 12,
          platform: 'android',
          hardware: 'qcom',
          model: 'Test',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('mnn');
        expect(rec.bannerText).toContain('Snapdragon');
      });
    });

    describe('Android non-Qualcomm recommendations', () => {
      it('recommends MNN for non-Qualcomm Android', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'android',
          hardware: 'mt6789',
          model: 'Test',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('mnn');
        expect(rec.bannerText).toContain('GPU');
        expect(rec.bannerText).toContain('888');
        expect(rec.compatibleBackends).toEqual(['mnn']);
      });

      it('recommends MNN for Tensor (Pixel) devices', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'android',
          hardware: 'unknown-hw',
          model: 'Pixel 8 Pro',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('mnn');
      });
    });

    describe('Android Qualcomm without SM prefix', () => {
      it('recommends MNN for Qualcomm with non-SM SoC (e.g. native module unavailable)', async () => {
        Platform.OS = 'android' as typeof Platform.OS;
        NativeModules.LocalDreamModule = {
          getSoCModel: jest.fn().mockResolvedValue(''),
        };
        mockedDeviceInfo.getTotalMemory.mockResolvedValue(
          8 * 1024 * 1024 * 1024,
        );
        mockedDeviceInfo.getUsedMemory.mockResolvedValue(
          2 * 1024 * 1024 * 1024,
        );
        mockedDeviceInfo.getModel.mockReturnValue('POCO F3');
        mockedDeviceInfo.getSystemName.mockReturnValue('Android');
        mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
        mockedDeviceInfo.isEmulator.mockResolvedValue(false);
        mockedDeviceInfo.getHardware.mockResolvedValue('qcom');
        await hardwareService.getDeviceInfo();

        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('mnn');
        expect(rec.bannerText).toContain('GPU');
        expect(rec.compatibleBackends).toEqual(['mnn']);
      });
    });

    describe('low RAM warning', () => {
      it('adds warning for devices under 4GB', async () => {
        await setupDevice({
          totalGB: 3,
          platform: 'android',
          hardware: 'qcom',
          model: 'Test',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.warning).toContain('Low RAM');
      });

      it('has no warning for devices with 4GB+', async () => {
        await setupDevice({
          totalGB: 8,
          platform: 'android',
          hardware: 'qcom',
          model: 'Test',
        });
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.warning).toBeUndefined();
      });
    });

    it('caches recommendation after first call', async () => {
      await setupDevice({
        totalGB: 8,
        platform: 'ios',
        deviceId: 'iPhone16,2',
      });
      const first = await hardwareService.getImageModelRecommendation();
      const second = await hardwareService.getImageModelRecommendation();
      expect(first).toBe(second);
    });

    describe('Android Qualcomm 8gen1 and min variant recommendations', () => {
      afterEach(() => {
        Platform.OS = originalOS;
        delete NativeModules.LocalDreamModule;
      });

      const setupQualcommDevice = async (socModel: string) => {
        Platform.OS = 'android' as typeof Platform.OS;
        NativeModules.LocalDreamModule = {
          getSoCModel: jest.fn().mockResolvedValue(socModel),
        };
        mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
        mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
        mockedDeviceInfo.getModel.mockReturnValue('Test');
        mockedDeviceInfo.getSystemName.mockReturnValue('Android');
        mockedDeviceInfo.getSystemVersion.mockReturnValue('14');
        mockedDeviceInfo.isEmulator.mockResolvedValue(false);
        mockedDeviceInfo.getHardware.mockResolvedValue('qcom');
        await hardwareService.getDeviceInfo();
      };

      it('returns qnn recommendation for 8gen1 Qualcomm device', async () => {
        await setupQualcommDevice('SM8450-AB'); // 8gen1
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('qnn');
        expect(rec.qnnVariant).toBe('8gen1');
        expect(rec.bannerText).toContain('NPU');
      });

      it('returns qnn recommendation for min (Snapdragon 888) Qualcomm device', async () => {
        await setupQualcommDevice('SM8350-AC'); // min
        const rec = await hardwareService.getImageModelRecommendation();
        expect(rec.recommendedBackend).toBe('qnn');
        expect(rec.qnnVariant).toBe('min');
        expect(rec.bannerText).toContain('lightweight');
      });
    });
  });

  describe('getTotalMemoryGB — background fetch callbacks', () => {
    it('updates cachedDeviceInfo.totalMemory in .then when cache is populated', async () => {
      // Setup: populate cachedDeviceInfo first
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(8 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getUsedMemory.mockResolvedValue(2 * 1024 * 1024 * 1024);
      mockedDeviceInfo.getModel.mockReturnValue('Test');
      mockedDeviceInfo.getSystemName.mockReturnValue('Android');
      mockedDeviceInfo.getSystemVersion.mockReturnValue('13');
      mockedDeviceInfo.isEmulator.mockResolvedValue(false);
      await hardwareService.getDeviceInfo();
      // Clear cache to trigger background fetch path
      (hardwareService as any).cachedDeviceInfo = null;
      // Mock a new resolved value for the background fetch
      mockedDeviceInfo.getTotalMemory.mockResolvedValue(16 * 1024 * 1024 * 1024);
      // Call getTotalMemoryGB — triggers background fetch, returns default 4
      const result = hardwareService.getTotalMemoryGB();
      expect(result).toBe(4);
      // Now populate cache before promise resolves (simulate race condition)
      (hardwareService as any).cachedDeviceInfo = { totalMemory: 8 * 1024 * 1024 * 1024, availableMemory: 6 * 1024 * 1024 * 1024 };
      await new Promise(resolve => setTimeout(resolve, 10));
      // The .then callback should have updated totalMemory
      expect((hardwareService as any).cachedDeviceInfo.totalMemory).toBe(16 * 1024 * 1024 * 1024);
    });

    it('logs warning when getTotalMemory rejects in getTotalMemoryGB background fetch', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockedDeviceInfo.getTotalMemory.mockRejectedValueOnce(new Error('memory error'));
      hardwareService.getTotalMemoryGB();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch total memory'),
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });

    it('logs warning when getTotalMemory rejects in getAvailableMemoryGB background fetch', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      mockedDeviceInfo.getTotalMemory.mockRejectedValueOnce(new Error('mem error'));
      hardwareService.getAvailableMemoryGB();
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to fetch available memory'),
        expect.any(Error),
      );
      warnSpy.mockRestore();
    });
  });

  // ========================================================================
  // getAccelerationCapability — composes NPU (HTP) + GPU (OpenCL) into one source
  // ========================================================================
  describe('getAccelerationCapability', () => {
    const origOS = Platform.OS;
    afterEach(() => { Object.defineProperty(Platform, 'OS', { value: origOS, configurable: true }); });

    it('reports NPU + GPU from the SoC and OpenCL probes on Android', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      jest.spyOn(hardwareService, 'getSoCInfo').mockResolvedValue({ vendor: 'qualcomm', hasNPU: true } as any);
      jest.spyOn(hardwareService, 'getOpenCLCapability').mockResolvedValue({ supported: true });
      expect(await hardwareService.getAccelerationCapability()).toEqual({ hasNpu: true, hasGpu: true });
    });

    it('has no acceleration on a device with neither', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
      jest.spyOn(hardwareService, 'getSoCInfo').mockResolvedValue({ vendor: 'other', hasNPU: false } as any);
      jest.spyOn(hardwareService, 'getOpenCLCapability').mockResolvedValue({ supported: false, reason: 'no_compatible_gpu' });
      expect(await hardwareService.getAccelerationCapability()).toEqual({ hasNpu: false, hasGpu: false });
    });

    it('reports nothing on iOS (llama.rn HTP/OpenCL are Android-only)', async () => {
      Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
      expect(await hardwareService.getAccelerationCapability()).toEqual({ hasNpu: false, hasGpu: false });
    });
  });
});
