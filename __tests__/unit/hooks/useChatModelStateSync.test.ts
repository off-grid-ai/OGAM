/**
 * Characterization tests for useChatModelStateSync — it had ZERO tests, and it owns the
 * capability derivation being centralized onto deriveEngineCapabilities. These pin the EXACT
 * current behavior (the two effects that set supportsVision / supportsToolCalling /
 * supportsThinking across remote / LiteRT / llama) so the migration is provably behavior-neutral.
 * Note the two DIFFERENT remote checks preserved verbatim: the vision effect keys on
 * activeModelInfo.isRemote; the tools/thinking effect keys on activeRemoteTextModelId.
 */
import { renderHook } from '@testing-library/react-native';
import { useChatModelStateSync } from '../../../src/screens/ChatScreen/useChatModelActions';

jest.mock('../../../src/services/llm', () => ({
  llmService: {
    isModelLoaded: jest.fn(() => false),
    getMultimodalSupport: jest.fn(() => null),
    supportsToolCalling: jest.fn(() => false),
    supportsThinking: jest.fn(() => false),
  },
}));
jest.mock('../../../src/services/litert', () => ({
  liteRTService: { isModelLoaded: jest.fn(() => false) },
}));

const { llmService } = require('../../../src/services/llm');
const { liteRTService } = require('../../../src/services/litert');

function run(deps: Partial<Parameters<typeof useChatModelStateSync>[0]>) {
  const setSupportsVision = jest.fn();
  const setSupportsToolCalling = jest.fn();
  const setSupportsThinking = jest.fn();
  renderHook(() =>
    useChatModelStateSync({
      activeModelInfo: { isRemote: false },
      activeModelId: 'm1',
      activeModel: undefined,
      modelDeps: {},
      activeRemoteModel: null,
      activeRemoteTextModelId: null,
      isModelLoading: false,
      setSupportsVision,
      setSupportsToolCalling,
      setSupportsThinking,
      ...(deps as any),
    }),
  );
  const last = (fn: jest.Mock) => fn.mock.calls.at(-1)?.[0];
  return {
    vision: last(setSupportsVision),
    tools: last(setSupportsToolCalling),
    thinking: last(setSupportsThinking),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  llmService.isModelLoaded.mockReturnValue(false);
  llmService.getMultimodalSupport.mockReturnValue(null);
  llmService.supportsToolCalling.mockReturnValue(false);
  llmService.supportsThinking.mockReturnValue(false);
  liteRTService.isModelLoaded.mockReturnValue(false);
});

describe('useChatModelStateSync — capability derivation (characterization)', () => {
  it('remote model: caps come from the declared remote capabilities', () => {
    const r = run({
      activeModelInfo: { isRemote: true },
      activeRemoteTextModelId: 'srv/llama',
      activeRemoteModel: { capabilities: { supportsVision: true, supportsToolCalling: true, supportsThinking: false } },
    });
    expect(r).toEqual({ vision: true, tools: true, thinking: false });
  });

  it('LiteRT model LOADED: vision from the flag, tools+thinking true', () => {
    liteRTService.isModelLoaded.mockReturnValue(true);
    const r = run({ activeModel: { engine: 'litert', liteRTVision: true } as any });
    expect(r).toEqual({ vision: true, tools: true, thinking: true });
  });

  it('LiteRT model NOT loaded: vision STILL from the flag, tools/thinking false', () => {
    liteRTService.isModelLoaded.mockReturnValue(false);
    const r = run({ activeModel: { engine: 'litert', liteRTVision: true } as any });
    expect(r).toEqual({ vision: true, tools: false, thinking: false });
  });

  it('llama model LOADED with vision mmproj: caps from the live engine', () => {
    llmService.isModelLoaded.mockReturnValue(true);
    llmService.getMultimodalSupport.mockReturnValue({ vision: true });
    llmService.supportsToolCalling.mockReturnValue(true);
    llmService.supportsThinking.mockReturnValue(true);
    const r = run({ activeModel: { engine: 'llama', mmProjPath: '/mmproj.gguf' } as any });
    expect(r).toEqual({ vision: true, tools: true, thinking: true });
  });

  it('nothing loaded (local, no engine ready): all false', () => {
    const r = run({ activeModel: { engine: 'llama' } as any });
    expect(r).toEqual({ vision: false, tools: false, thinking: false });
  });
});
