/**
 * Contract unit tests for activeModelService.supportsVision / supportsToolCalling
 * / supportsThinking — the SINGLE source of truth that replaced the capability
 * rule the ChatScreen hooks recomputed inline 5+ times
 * (`engine === 'litert' ? … : llmService…`, plus the remote variants).
 *
 * Driving the REAL activeModelService with a litert model, a llama model, and a
 * remote model asserts each rule dispatches to the correct engine. Only the
 * native/engine + store boundaries are mocked (dumb data sources); the dispatch
 * logic under test runs for real. Fails-before (methods didn't exist) /
 * passes-after.
 */

jest.mock('../../../src/stores', () => ({
  useAppStore: { getState: jest.fn() },
  useRemoteServerStore: { getState: jest.fn() },
}));
jest.mock('../../../src/stores/debugLogsStore', () => ({
  useDebugLogsStore: { getState: jest.fn(() => ({ addLog: jest.fn() })) },
}));
jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(() => false),
    getMultimodalSupport: jest.fn(() => null),
    supportsToolCalling: jest.fn(() => false),
    supportsThinking: jest.fn(() => false),
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
jest.mock('../../../src/services/remoteServerManager', () => ({
  remoteServerManager: {},
}));
jest.mock('../../../src/utils/logger', () => ({
  __esModule: true,
  default: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { activeModelService } from '../../../src/services/activeModelService';
import { liteRTService } from '../../../src/services/litert';
import { llmService } from '../../../src/services/llm';
import { useAppStore, useRemoteServerStore } from '../../../src/stores';

const mockedGetState = useAppStore.getState as jest.Mock;
const mockedRemoteGetState = useRemoteServerStore.getState as jest.Mock;
const mockedLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockedLlm = llmService as jest.Mocked<typeof llmService>;

function setActiveModel(model: any) {
  mockedGetState.mockReturnValue({
    activeModelId: model?.id ?? null,
    downloadedModels: model ? [model] : [],
  });
}

function setActiveRemoteModel(capabilities: any) {
  mockedRemoteGetState.mockReturnValue({
    getActiveRemoteTextModel: () =>
      capabilities ? { id: 'r', name: 'remote', capabilities } : null,
  });
}

describe('activeModelService capability dispatch (single source of truth)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: no remote model active.
    setActiveRemoteModel(null);
  });

  describe('no active model', () => {
    it('reports every capability false', () => {
      setActiveModel(null);
      expect(activeModelService.supportsVision()).toBe(false);
      expect(activeModelService.supportsToolCalling()).toBe(false);
      expect(activeModelService.supportsThinking()).toBe(false);
    });
  });

  describe('LiteRT model', () => {
    it('vision comes from the static liteRTVision flag (known before load)', () => {
      setActiveModel({ id: 'm', engine: 'litert', liteRTVision: true });
      // Not loaded natively — vision is still known from the model flag.
      mockedLiteRT.isModelLoaded.mockReturnValue(false);
      expect(activeModelService.supportsVision()).toBe(true);

      setActiveModel({ id: 'm', engine: 'litert', liteRTVision: false });
      expect(activeModelService.supportsVision()).toBe(false);
    });

    it('tool calling / thinking are true only once the model is loaded', () => {
      setActiveModel({ id: 'm', engine: 'litert', liteRTVision: false });
      mockedLiteRT.isModelLoaded.mockReturnValue(true);
      expect(activeModelService.supportsToolCalling()).toBe(true);
      expect(activeModelService.supportsThinking()).toBe(true);

      mockedLiteRT.isModelLoaded.mockReturnValue(false);
      expect(activeModelService.supportsToolCalling()).toBe(false);
      expect(activeModelService.supportsThinking()).toBe(false);
    });
  });

  describe('llama.cpp model', () => {
    it('vision comes from the loaded multimodal projector', () => {
      setActiveModel({ id: 'm', engine: 'llama' });
      mockedLlm.isModelLoaded.mockReturnValue(true);
      mockedLlm.getMultimodalSupport.mockReturnValue({ vision: true, audio: false });
      expect(activeModelService.supportsVision()).toBe(true);

      mockedLlm.getMultimodalSupport.mockReturnValue({ vision: false, audio: false });
      expect(activeModelService.supportsVision()).toBe(false);
    });

    it('vision is false while the model is not loaded (projector unknown)', () => {
      setActiveModel({ id: 'm', engine: 'llama' });
      mockedLlm.isModelLoaded.mockReturnValue(false);
      mockedLlm.getMultimodalSupport.mockReturnValue({ vision: true, audio: false });
      expect(activeModelService.supportsVision()).toBe(false);
    });

    it('tool calling / thinking come from the loaded model and require load', () => {
      setActiveModel({ id: 'm', engine: 'llama' });
      mockedLlm.isModelLoaded.mockReturnValue(true);
      mockedLlm.supportsToolCalling.mockReturnValue(true);
      mockedLlm.supportsThinking.mockReturnValue(false);
      expect(activeModelService.supportsToolCalling()).toBe(true);
      expect(activeModelService.supportsThinking()).toBe(false);

      // Not loaded → both false regardless of what the engine would report.
      mockedLlm.isModelLoaded.mockReturnValue(false);
      mockedLlm.supportsToolCalling.mockReturnValue(true);
      mockedLlm.supportsThinking.mockReturnValue(true);
      expect(activeModelService.supportsToolCalling()).toBe(false);
      expect(activeModelService.supportsThinking()).toBe(false);
    });
  });

  describe('remote model (takes precedence over any selected local model)', () => {
    it('reports the advertised capabilities verbatim', () => {
      setActiveModel({ id: 'm', engine: 'llama' }); // a local model is also selected
      setActiveRemoteModel({
        supportsVision: true,
        supportsToolCalling: false,
        supportsThinking: true,
      });
      expect(activeModelService.supportsVision()).toBe(true);
      expect(activeModelService.supportsToolCalling()).toBe(false);
      expect(activeModelService.supportsThinking()).toBe(true);
    });

    it('all-false capabilities are reported as false', () => {
      setActiveRemoteModel({
        supportsVision: false,
        supportsToolCalling: false,
        supportsThinking: false,
      });
      expect(activeModelService.supportsVision()).toBe(false);
      expect(activeModelService.supportsToolCalling()).toBe(false);
      expect(activeModelService.supportsThinking()).toBe(false);
    });
  });
});
