/**
 * Integration test for the boot-time backend-default sync.
 *
 * Drives the REAL appStore across the real backendResolver -> updateSettings
 * path. The ONLY mocked boundary is the native GPU probe
 * (hardwareService.getOpenCLCapability) — everything else (resolver mapping,
 * store write, the backendUserChosen guard) runs for real. Deleting the sync
 * implementation would fail these assertions.
 */
import { Platform } from 'react-native';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';
import { hardwareService } from '../../../src/services/hardware';
import {
  startBackendDefaultSync,
  __resetBackendDefaultSyncForTests,
} from '../../../src/services/backendSync';
import { INFERENCE_BACKENDS } from '../../../src/types';

describe('startBackendDefaultSync (integration)', () => {
  const originalOS = Platform.OS;
  let openCLSpy: jest.SpyInstance;
  let socSpy: jest.SpyInstance;

  beforeEach(() => {
    resetStores();
    __resetBackendDefaultSyncForTests();
    // Default: non-Qualcomm (no NPU) so the GPU/CPU branches are exercised; the NPU
    // case overrides this. hasNPU being Qualcomm-only is enforced in hardware.ts.
    socSpy = jest
      .spyOn(hardwareService, 'getSoCInfo')
      .mockResolvedValue({ vendor: 'mediatek', hasNPU: false } as never);
  });

  afterEach(() => {
    Platform.OS = originalOS;
    openCLSpy?.mockRestore();
    socSpy?.mockRestore();
  });

  it('fresh Android + OpenCL-supported install auto-selects the GPU (OPENCL) backend and enables GPU', async () => {
    Platform.OS = 'android' as typeof Platform.OS;
    openCLSpy = jest
      .spyOn(hardwareService, 'getOpenCLCapability')
      .mockResolvedValue({ supported: true });

    // Precondition: static default is CPU on Android, GPU disabled.
    expect(useAppStore.getState().settings.inferenceBackend).toBe(INFERENCE_BACKENDS.CPU);

    await startBackendDefaultSync();

    const settings = useAppStore.getState().settings;
    expect(settings.inferenceBackend).toBe(INFERENCE_BACKENDS.OPENCL);
    expect(settings.liteRTBackend).toBe('gpu');
    expect(settings.enableGpu).toBe(true);
  });

  it('flagship Qualcomm (8gen2) auto-selects the NPU (HTP) backend', async () => {
    Platform.OS = 'android' as typeof Platform.OS;
    openCLSpy = jest
      .spyOn(hardwareService, 'getOpenCLCapability')
      .mockResolvedValue({ supported: true });
    socSpy.mockResolvedValue({ vendor: 'qualcomm', hasNPU: true, qnnVariant: '8gen2' } as never);

    await startBackendDefaultSync();

    expect(useAppStore.getState().settings.inferenceBackend).toBe(INFERENCE_BACKENDS.HTP);
    expect(useAppStore.getState().settings.enableGpu).toBe(true);
  });

  it("non-flagship Qualcomm ('min', e.g. SM8635) auto-selects GPU, not the beta NPU", async () => {
    Platform.OS = 'android' as typeof Platform.OS;
    openCLSpy = jest
      .spyOn(hardwareService, 'getOpenCLCapability')
      .mockResolvedValue({ supported: true });
    socSpy.mockResolvedValue({ vendor: 'qualcomm', hasNPU: true, qnnVariant: 'min' } as never);

    await startBackendDefaultSync();

    expect(useAppStore.getState().settings.inferenceBackend).toBe(INFERENCE_BACKENDS.OPENCL);
  });

  it('does NOT override when the user has already chosen a backend', async () => {
    Platform.OS = 'android' as typeof Platform.OS;
    openCLSpy = jest
      .spyOn(hardwareService, 'getOpenCLCapability')
      .mockResolvedValue({ supported: true });

    // User explicitly picked CPU.
    useAppStore.getState().updateSettings({
      inferenceBackend: INFERENCE_BACKENDS.CPU,
      backendUserChosen: true,
    });

    await startBackendDefaultSync();

    expect(useAppStore.getState().settings.inferenceBackend).toBe(INFERENCE_BACKENDS.CPU);
    // The probe should never even run when the user has chosen.
    expect(openCLSpy).not.toHaveBeenCalled();
  });

  it('unsupported OpenCL on Android keeps CPU', async () => {
    Platform.OS = 'android' as typeof Platform.OS;
    openCLSpy = jest
      .spyOn(hardwareService, 'getOpenCLCapability')
      .mockResolvedValue({ supported: false, reason: 'no_compatible_gpu' });

    await startBackendDefaultSync();

    const settings = useAppStore.getState().settings;
    expect(settings.inferenceBackend).toBe(INFERENCE_BACKENDS.CPU);
    expect(settings.liteRTBackend).toBe('cpu');
    expect(settings.enableGpu).toBe(false);
  });

  it('is a singleton — repeated calls run the probe once', async () => {
    Platform.OS = 'android' as typeof Platform.OS;
    openCLSpy = jest
      .spyOn(hardwareService, 'getOpenCLCapability')
      .mockResolvedValue({ supported: true });

    await Promise.all([startBackendDefaultSync(), startBackendDefaultSync()]);
    await startBackendDefaultSync();

    expect(openCLSpy).toHaveBeenCalledTimes(1);
  });
});
