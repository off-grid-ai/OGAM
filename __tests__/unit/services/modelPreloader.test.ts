/**
 * modelPreloader tests — warms selected models in priority order (text → image
 * → TTS → STT), only loading what fits the budget without eviction.
 */
let mockAppState: any;
let mockWhisperState: any;
jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: () => mockAppState },
  useWhisperStore: { getState: () => mockWhisperState },
}));

const mockLoadText = jest.fn((..._a: any[]) => Promise.resolve());
const mockLoadImage = jest.fn((..._a: any[]) => Promise.resolve());
const mockGetActiveModels = jest.fn(() => ({ text: { isLoaded: false }, image: { isLoaded: false } }));
jest.mock('../../../src/services/activeModelService', () => ({
  activeModelService: {
    loadTextModel: (...a: any[]) => mockLoadText(...a),
    loadImageModel: (...a: any[]) => mockLoadImage(...a),
    getActiveModels: () => mockGetActiveModels(),
  },
}));

jest.mock('../../../src/services/hardware', () => ({
  hardwareService: { estimateModelRam: (m: any) => (m.fileSize || m.size || 0) * 1.5 },
}));

jest.mock('../../../src/services/whisperService', () => ({
  WHISPER_MODELS: [{ id: 'w1', size: 150 }],
}));

const mockCanLoad = jest.fn((_spec?: any) => true);
jest.mock('../../../src/services/modelResidency', () => ({
  modelResidencyManager: { canLoadWithoutEviction: (...a: any[]) => mockCanLoad(...a) },
}));

const mockCallHook = jest.fn((..._a: any[]) => Promise.resolve());
jest.mock('../../../src/bootstrap/hookRegistry', () => ({
  callHook: (...a: any[]) => mockCallHook(...a),
  HOOKS: { audioPreload: 'audio.preload' },
}));

let mockTextGenerating = false;
let mockImageGenerating = false;
jest.mock('../../../src/services/generationService', () => ({
  generationService: { getState: () => ({ isGenerating: mockTextGenerating }) },
}));
jest.mock('../../../src/services/imageGenerationService', () => ({
  imageGenerationService: { getState: () => ({ isGenerating: mockImageGenerating }) },
}));

import { preloadSelectedModels, _resetPreloaderForTesting } from '../../../src/services/modelPreloader';

describe('preloadSelectedModels', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _resetPreloaderForTesting();
    mockTextGenerating = false;
    mockImageGenerating = false;
    mockCanLoad.mockReturnValue(true);
    mockGetActiveModels.mockReturnValue({ text: { isLoaded: false }, image: { isLoaded: false } });
    mockAppState = {
      activeModelId: 'txt', lastTextModelId: 'txt',
      downloadedModels: [{ id: 'txt', fileSize: 1024 * 1024 * 700 }],
      activeImageModelId: 'img',
      downloadedImageModels: [{ id: 'img', size: 1024 * 1024 * 400 }],
    };
    mockWhisperState = { downloadedModelId: 'w1', isModelLoaded: false, loadModel: jest.fn(() => Promise.resolve()) };
  });

  it('warms text, TTS and STT in order — but never the image model', async () => {
    await preloadSelectedModels();
    expect(mockLoadText).toHaveBeenCalledWith('txt');
    expect(mockCallHook).toHaveBeenCalledWith('audio.preload');
    expect(mockWhisperState.loadModel).toHaveBeenCalled();
    // Image is deliberately excluded from boot preload (loads on demand).
    expect(mockLoadImage).not.toHaveBeenCalled();
  });

  it('never preloads the image model even when it would fit', async () => {
    mockCanLoad.mockReturnValue(true);
    await preloadSelectedModels();
    expect(mockLoadImage).not.toHaveBeenCalled();
    expect(mockLoadText).toHaveBeenCalled();
    expect(mockWhisperState.loadModel).toHaveBeenCalled();
  });

  it('skips models that are already loaded', async () => {
    mockGetActiveModels.mockReturnValue({ text: { isLoaded: true }, image: { isLoaded: true } });
    await preloadSelectedModels();
    expect(mockLoadText).not.toHaveBeenCalled();
    expect(mockLoadImage).not.toHaveBeenCalled();
  });

  it('runs only once', async () => {
    await preloadSelectedModels();
    await preloadSelectedModels();
    expect(mockLoadText).toHaveBeenCalledTimes(1);
  });

  it('warms nothing once aborted (user became active)', async () => {
    const { abortPreload } = require('../../../src/services/modelPreloader');
    abortPreload();
    await preloadSelectedModels();
    expect(mockLoadText).not.toHaveBeenCalled();
    expect(mockWhisperState.loadModel).not.toHaveBeenCalled();
  });

  it('warms nothing when a text generation is already active', async () => {
    mockTextGenerating = true;
    await preloadSelectedModels();
    expect(mockLoadText).not.toHaveBeenCalled();
    expect(mockLoadImage).not.toHaveBeenCalled();
    expect(mockWhisperState.loadModel).not.toHaveBeenCalled();
  });

  it('warms nothing when an image generation is already active', async () => {
    mockImageGenerating = true;
    await preloadSelectedModels();
    expect(mockLoadText).not.toHaveBeenCalled();
    expect(mockLoadImage).not.toHaveBeenCalled();
  });

  it('no-ops for unselected modalities', async () => {
    mockAppState.activeModelId = null;
    mockAppState.lastTextModelId = null;
    mockAppState.activeImageModelId = null;
    mockWhisperState.downloadedModelId = null;
    await preloadSelectedModels();
    expect(mockLoadText).not.toHaveBeenCalled();
    expect(mockLoadImage).not.toHaveBeenCalled();
    expect(mockWhisperState.loadModel).not.toHaveBeenCalled();
  });
});
