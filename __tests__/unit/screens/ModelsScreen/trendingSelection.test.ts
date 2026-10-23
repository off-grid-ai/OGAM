/**
 * trendingSelection.test.ts
 *
 * The curated and trending lists in useTextModels offer a model when it loads on the phone by the
 * shared fit rule: its download against the phone budget, not a parameter count.
 */

import { renderHook } from '@testing-library/react-native';
import { useTextModels } from '../../../../src/screens/ModelsScreen/useTextModels';

// ── Navigation (required by useFocusEffect) ─────────────────────────
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
  useFocusEffect: jest.fn((cb: () => () => void) => { cb(); }),
}));

// ── App store ────────────────────────────────────────────────────────
jest.mock('../../../../src/stores', () => ({
  useAppStore: jest.fn(() => ({
    downloadedModels: [],
    setDownloadedModels: jest.fn(),
    downloadProgress: {},
    setDownloadProgress: jest.fn(),
    addDownloadedModel: jest.fn(),
    removeDownloadedModel: jest.fn(),
    activeModelId: null,
  })),
}));

// ── Services ─────────────────────────────────────────────────────────
const mockGetTotalMemoryGB = jest.fn(() => 8);
const mockGetModelRecommendation = jest.fn(() => ({ recommendedQuantization: 'Q4_K_M', recommendedModels: [] }));

jest.mock('../../../../src/services', () => ({
  huggingFaceService: {
    searchModels: jest.fn(() => Promise.resolve([])),
    getModelDetails: jest.fn(() => Promise.reject(new Error('not found'))),
    getModelFiles: jest.fn(() => Promise.resolve([])),
  },
  modelManager: {
    getDownloadedModels: jest.fn(() => Promise.resolve([])),
    downloadModelBackground: jest.fn(),
    watchDownload: jest.fn(),
    cancelBackgroundDownload: jest.fn(),
    repairMmProj: jest.fn(),
    deleteModel: jest.fn(),
  },
  hardwareService: {
    getTotalMemoryGB: () => mockGetTotalMemoryGB(),
    getModelRecommendation: () => mockGetModelRecommendation(),
  },
  activeModelService: {
    // The model-selection seam, from the one place it is defined.
    ...require('../../../utils/activeModelServiceStub').activeModelSelectionStub(),
    unloadTextModel: jest.fn(() => Promise.resolve()),
  },
}));

// ── Alert component ───────────────────────────────────────────────────
jest.mock('../../../../src/components/CustomAlert', () => ({
  showAlert: jest.fn((title: string, message: string) => ({ title, message, visible: true })),
  initialAlertState: { title: '', message: '', visible: false },
}));

// ─────────────────────────────────────────────────────────────────────

const setAlertState = jest.fn();

describe('curated models offered by what loads on the phone', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // A 12 GB iPhone reports about 11.2 GB. The shared phone budget loads a download up to half of it.
  const TWELVE_GB_IPHONE = 11.2;

  it('offers a 12 GB iPhone the 9B class it loads, above any parameter cap, and hides what it cannot', () => {
    mockGetTotalMemoryGB.mockReturnValue(TWELVE_GB_IPHONE);

    const { result } = renderHook(() => useTextModels(setAlertState));
    const offered = result.current.recommendedAsModelInfo.map(m => m.id);

    // Measured on a 12 GB iPhone 17 Pro Max: a 9B Q4_K_M and Gemma 4 E4B load (mapped weights).
    expect(offered).toContain('unsloth/Qwen3.5-9B-GGUF');
    expect(offered).toContain('unsloth/gemma-4-E4B-it-GGUF');
    expect(offered).toContain('LiquidAI/LFM2.5-8B-A1B-GGUF');
    // Gemma 4 12B is 7.3 GB with its projector: past 0.62 of this phone's RAM.
    expect(offered).not.toContain('unsloth/gemma-4-12b-it-GGUF');
  });

  it('picks the trending model per family from what loads on a 12 GB iPhone', () => {
    mockGetTotalMemoryGB.mockReturnValue(TWELVE_GB_IPHONE);

    const { result } = renderHook(() => useTextModels(setAlertState));
    const trending = result.current.trendingAsModelInfo.map(m => m.id);

    expect(trending).toContain('unsloth/gemma-4-E2B-it-GGUF');
    expect(trending).toHaveLength(3);
  });

  it('offers a 16 GB phone the larger models it can load', () => {
    mockGetTotalMemoryGB.mockReturnValue(15);

    const { result } = renderHook(() => useTextModels(setAlertState));
    const offered = result.current.recommendedAsModelInfo.map(m => m.id);

    expect(offered).toContain('unsloth/Qwen3.5-9B-GGUF');
    expect(offered).toContain('unsloth/gemma-4-E4B-it-GGUF');
  });

  it('offers nothing to a phone too small to load any model', () => {
    mockGetTotalMemoryGB.mockReturnValue(1);

    const { result } = renderHook(() => useTextModels(setAlertState));

    expect(result.current.recommendedAsModelInfo).toHaveLength(0);
    expect(result.current.trendingAsModelInfo).toHaveLength(0);
  });
});
