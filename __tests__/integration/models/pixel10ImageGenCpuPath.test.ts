import { Platform } from 'react-native';
import DeviceInfo from 'react-native-device-info';
import { hardwareService } from '../../../src/services/hardware';

const originalOS = Platform.OS;

jest.mock('react-native-device-info', () => ({
  getModel: jest.fn(() => 'Pixel 10 Pro XL'),
  getHardware: jest.fn(async () => 'tensor'),
  getTotalMemory: jest.fn(async () => 12 * 1024 * 1024 * 1024),
  getUsedMemory: jest.fn(async () => 4 * 1024 * 1024 * 1024),
  getSystemName: jest.fn(() => 'Android'),
  getSystemVersion: jest.fn(() => '17'),
  isEmulator: jest.fn(async () => false),
  getDeviceId: jest.fn(() => 'pixel10'),
}));

describe('Pixel 10 image generation CPU path integration', () => {
  beforeEach(() => {
    Platform.OS = 'android';
    (hardwareService as any).cachedDeviceInfo = null;
    (hardwareService as any).cachedSoCInfo = null;
    (hardwareService as any).cachedImageRecommendation = null;
    (hardwareService as any).cachedOpenCLCapability = null;
    jest.clearAllMocks();
  });

  afterEach(() => {
    Platform.OS = originalOS;
  });

  it('detects Pixel 10 and disables OpenCL image acceleration', async () => {
    expect(hardwareService.requiresCpuImageBackend()).toBe(true);
    const openCl = await hardwareService.getOpenCLCapability();
    expect(openCl.supported).toBe(false);
    expect(openCl.reason).toBe('pixel_10_cpu_only');
  });

  it('recommends only MNN models with a Pixel 10-specific banner', async () => {
    const rec = await hardwareService.getImageModelRecommendation();
    expect(rec.recommendedBackend).toBe('mnn');
    expect(rec.compatibleBackends).toEqual(['mnn']);
    expect(rec.bannerText).toContain('Pixel 10');
    expect(DeviceInfo.getModel).toHaveBeenCalled();
  });
});
