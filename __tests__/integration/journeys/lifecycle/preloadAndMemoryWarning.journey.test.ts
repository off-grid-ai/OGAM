/**
 * JOURNEY — boot preloader priority + memory-warning mid-generation (cluster A).
 *
 * (A) Boot preloader (modelPreloader.ts): warms text → TTS → STT in priority order.
 *     Warming a lower-priority model must NEVER evict a higher-priority one already
 *     resident — each step is gated by canLoadWithoutEviction. We prove: with the
 *     text model already resident and the budget too small for text+whisper, the STT
 *     warm step does NOT evict text (it declines instead).
 *
 * (B) Memory warning mid-generation (modelResidency.handleMemoryWarning): a memory
 *     pressure event reclaims idle SIDECAR models (whisper/tts/embedding) but must
 *     LEAVE the active generation (text/image) model resident — reclaiming the model
 *     that is actively answering would kill the turn.
 *
 * Drives the REAL modelResidencyManager + preloader + stores; native engines and the
 * RAM sensor mocked. Terminal artifact: getResidents()/isResident() after each event.
 */

import { Platform } from 'react-native';
import { useAppStore } from '../../../../src/stores/appStore';
import { modelResidencyManager } from '../../../../src/services/modelResidency';
import { hardwareService } from '../../../../src/services/hardware';
import {
  preloadSelectedModels,
  _resetPreloaderForTesting,
} from '../../../../src/services/modelPreloader';
import { resetStores, flushPromises } from '../../../utils/testHelpers';
import { createDeviceInfo } from '../../../utils/factories';

jest.mock('../../../../src/services/hardware');
jest.mock('../../../../src/services/llm');
jest.mock('../../../../src/services/litert');
jest.mock('../../../../src/services/localDreamGenerator');

// Whisper native + store boundary. loadModel goes through residency (as the real
// whisperStore does), so the preloader gate is exercised for real.
let mockWhisperNativeLoaded = false;
jest.mock('../../../../src/services/whisperService', () => ({
  whisperService: {
    getModelPath: (id: string) => `/models/ggml-${id}.bin`,
    loadModel: jest.fn(async () => {
      mockWhisperNativeLoaded = true;
    }),
    unloadModel: jest.fn(async () => {
      mockWhisperNativeLoaded = false;
    }),
    isModelLoaded: () => mockWhisperNativeLoaded,
    isModelDownloaded: jest.fn(async () => true),
    deleteModel: jest.fn(async () => {}),
    downloadModel: jest.fn(async () => '/models/x'),
  },
  WHISPER_MODELS: [{ id: 'base', size: 500 }],
}));

import { hardwareService as hw } from '../../../../src/services/hardware';
import { useWhisperStore } from '../../../../src/stores/whisperStore';

const mockHw = hw as jest.Mocked<typeof hardwareService>;
const originalOS = Platform.OS;

describe('JOURNEY: boot preloader priority + memory-warning mid-generation', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    modelResidencyManager._reset();
    _resetPreloaderForTesting();
    mockWhisperNativeLoaded = false;

    mockHw.getTotalMemoryGB.mockReturnValue(8);
    mockHw.getAvailableMemoryGB.mockReturnValue(6);
    mockHw.refreshMemoryInfo.mockResolvedValue({} as any);
    mockHw.getDeviceInfo.mockResolvedValue(
      createDeviceInfo({ totalMemory: 8 * 1024 * 1024 * 1024 }),
    );
    mockHw.estimateModelRam.mockImplementation(
      (m: any, mult = 1.5) => (m?.fileSize || m?.size || 0) * mult,
    );
    mockHw.getModelTotalSize.mockImplementation(
      (m: any) => m?.fileSize || m?.size || 0,
    );
    Platform.OS = 'ios' as typeof Platform.OS;
    modelResidencyManager.setLoadPolicy('balanced');
    useWhisperStore.setState({
      downloadedModelId: 'base',
      isModelLoaded: false,
      isModelLoading: false,
      error: null,
    });
  });

  afterEach(() => {
    modelResidencyManager.setBudgetOverrideMB(null);
    Platform.OS = originalOS;
  });

  it('preloader: warming STT never evicts an already-resident higher-priority text model', async () => {
    // 8GB budget ≈ 4915MB. A 4800MB text model is resident; a 500MB whisper would
    // exceed the budget alongside it → canLoadWithoutEviction must decline the warm.
    modelResidencyManager.setBudgetOverrideMB(4915);
    modelResidencyManager.register(
      { key: 'text', type: 'text', modelId: 'text-1', sizeMB: 4800 },
      async () => {},
    );
    // No text preload needed (already resident); the preloader will try to warm STT.
    useAppStore.setState({ activeModelId: 'text-1', lastTextModelId: 'text-1' });

    await preloadSelectedModels();
    await flushPromises();

    // TERMINAL: text still resident, whisper NOT warmed (it would have needed an
    // eviction of the higher-priority text model, which the preloader refuses).
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(modelResidencyManager.isResident('whisper')).toBe(false);
    expect(mockWhisperNativeLoaded).toBe(false);
    expect(modelResidencyManager.getResidents()).toHaveLength(1);
  });

  it('preloader: with room, STT warms alongside text (co-resident sidecar, no eviction)', async () => {
    modelResidencyManager.setBudgetOverrideMB(6000);
    modelResidencyManager.register(
      { key: 'text', type: 'text', modelId: 'text-1', sizeMB: 4800 },
      async () => {},
    );
    useAppStore.setState({ activeModelId: 'text-1', lastTextModelId: 'text-1' });

    await preloadSelectedModels();
    await flushPromises();

    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(mockWhisperNativeLoaded).toBe(true);
  });

  it('memory warning mid-generation: reclaims the idle STT sidecar but LEAVES the active text (generation) model resident', async () => {
    // Both resident: text (answering) + whisper (idle sidecar).
    modelResidencyManager.setBudgetOverrideMB(8000);
    let textUnloaded = false;
    modelResidencyManager.register(
      { key: 'text', type: 'text', modelId: 'text-1', sizeMB: 4800 },
      async () => {
        textUnloaded = true;
      },
    );
    await useWhisperStore.getState().loadModel();
    expect(modelResidencyManager.isResident('whisper')).toBe(true);

    // Memory pressure fires while the text model is generating.
    await modelResidencyManager.handleMemoryWarning();

    // TERMINAL: whisper reclaimed, text (active generation) untouched.
    expect(modelResidencyManager.isResident('whisper')).toBe(false);
    expect(mockWhisperNativeLoaded).toBe(false);
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(textUnloaded).toBe(false);
    expect(modelResidencyManager.getResidents().map(r => r.key)).toEqual(['text']);
  });

  it('memory warning does NOT reclaim a sidecar its owner vetoes (canEvict=false: e.g. transcription finalizing)', async () => {
    let whisperUnloaded = false;
    modelResidencyManager.register(
      {
        key: 'whisper',
        type: 'whisper',
        modelId: 'base',
        sizeMB: 500,
        canEvict: () => false, // in use — owner vetoes
      },
      async () => {
        whisperUnloaded = true;
      },
    );

    await modelResidencyManager.handleMemoryWarning();

    // In-use sidecar survives the warning.
    expect(modelResidencyManager.isResident('whisper')).toBe(true);
    expect(whisperUnloaded).toBe(false);
  });
});
