/**
 * Unit tests for activeModelService.supportsAudioInput().
 * This is the engine-agnostic dispatch point that decides whether the active
 * model accepts audio directly (LiteRT audio model, or llama.cpp audio mmproj),
 * letting Audio Mode skip Whisper STT without UI/hooks branching on engine type.
 */

jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: jest.fn() },
}));
jest.mock('../../../src/stores/debugLogsStore', () => ({
  useDebugLogsStore: { getState: jest.fn(() => ({ addLog: jest.fn() })) },
}));
jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(() => false),
    getMultimodalSupport: jest.fn(() => null),
    getPerformanceStats: jest.fn(() => undefined),
  },
}));
jest.mock('../../../src/services/litert', () => ({
  liteRTService: {
    isModelLoaded: jest.fn(() => false),
    supportsAudio: jest.fn(() => false),
  },
}));
jest.mock('../../../src/services/localDreamGenerator', () => ({
  localDreamGeneratorService: {},
}));
jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {},
}));
jest.mock('../../../src/services/modelResidency', () => ({
  modelResidencyManager: { runExclusive: jest.fn() },
}));
jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { activeModelService } from '../../../src/services/activeModelService';
import { liteRTService } from '../../../src/services/litert';
import { llmService } from '../../../src/services/llm';
import { useAppStore } from '../../../src/stores';

const mockedGetState = useAppStore.getState as jest.Mock;
const mockedLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockedLlm = llmService as jest.Mocked<typeof llmService>;

function setActiveModel(model: any) {
  mockedGetState.mockReturnValue({
    activeModelId: model?.id ?? null,
    downloadedModels: model ? [model] : [],
  });
}

describe('activeModelService.supportsAudioInput', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns false when there is no active model', () => {
    setActiveModel(null);
    expect(activeModelService.supportsAudioInput()).toBe(false);
  });

  it('returns true for a LiteRT model that reports audio support', () => {
    setActiveModel({ id: 'm', engine: 'litert', liteRTAudio: true });
    mockedLiteRT.supportsAudio.mockReturnValue(true);
    expect(activeModelService.supportsAudioInput()).toBe(true);
  });

  it('returns false for a LiteRT model without audio support', () => {
    setActiveModel({ id: 'm', engine: 'litert', liteRTAudio: false });
    mockedLiteRT.supportsAudio.mockReturnValue(false);
    expect(activeModelService.supportsAudioInput()).toBe(false);
  });

  it('returns true for a llama.cpp model whose mmproj reports audio', () => {
    setActiveModel({ id: 'm', engine: 'llama' });
    mockedLlm.isModelLoaded.mockReturnValue(true);
    mockedLlm.getMultimodalSupport.mockReturnValue({ vision: true, audio: true });
    expect(activeModelService.supportsAudioInput()).toBe(true);
  });

  it('returns false for a llama.cpp vision-only model (no audio in mmproj)', () => {
    setActiveModel({ id: 'm', engine: 'llama' });
    mockedLlm.isModelLoaded.mockReturnValue(true);
    mockedLlm.getMultimodalSupport.mockReturnValue({ vision: true, audio: false });
    expect(activeModelService.supportsAudioInput()).toBe(false);
  });

  it('returns false for a llama.cpp model that is not loaded yet', () => {
    setActiveModel({ id: 'm', engine: 'llama' });
    mockedLlm.isModelLoaded.mockReturnValue(false);
    mockedLlm.getMultimodalSupport.mockReturnValue({ vision: true, audio: true });
    expect(activeModelService.supportsAudioInput()).toBe(false);
  });
});
