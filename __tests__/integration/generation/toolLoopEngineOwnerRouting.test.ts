/**
 * DRY / single-owner — generationToolLoop routes through the ONE engine-caps owner (src/services/engines.ts).
 *
 * generationToolLoop used to re-derive "which engine is active" INLINE: isLiteRTActive() (line 423) read the
 * store AND conflated it with `liteRTService.isModelLoaded()`, instead of the owner getActiveEngineService()
 * (=== liteRTService), which defines "active engine" WITHOUT the loaded check (load-readiness is a separate
 * concern the sibling generationServiceHelpers.isLiteRTActive already treats separately). isUsingRemote /
 * callLLMWithRetry / selectEffectiveSchemas each also re-inlined the activeServer+hasProvider+!localLoaded
 * rule that engines.isRemoteTextModelActive() OWNS. #510 (4d88c249) promised a single source for active caps.
 *
 * This test drives the REAL runToolLoop over the REAL engines.ts + REAL stores (only the native leaves
 * llm/litert and the provider transport are faked — the sanctioned integration boundary), and asserts the
 * loop's engine choice MATCHES the owner's verdict. The GUARD case is the exact input where the inline
 * derivation and the owner DISAGREE — a LiteRT model active but not yet reporting loaded: the owner names
 * `litert`, the old inline conflation names `llama`. On HEAD the loop follows its private conflated rule and
 * routes to llama → RED. Once the loop routes through the owner it follows getActiveEngineService() → GREEN.
 */
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');

import { runToolLoop, type ToolLoopContext } from '../../../src/services/generationToolLoop';
import { liteRTService } from '../../../src/services/litert';
import { llmService } from '../../../src/services/llm';
import { getActiveEngineService, isRemoteTextModelActive } from '../../../src/services/engines';
import { useAppStore } from '../../../src/stores/appStore';
import { useRemoteServerStore } from '../../../src/stores/remoteServerStore';
import { providerRegistry } from '../../../src/services/providers';
import { resetStores, setupWithConversation } from '../../utils/testHelpers';
import { createDownloadedModel, createMessage } from '../../utils/factories';
import type { Message } from '../../../src/types';

const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockLlm = llmService as jest.Mocked<typeof llmService>;

let remoteProviderGenerate: jest.Mock;

/** The engine the loop ACTUALLY routed to, read off the native leaf that got driven. */
function engineTheLoopUsed(): 'litert' | 'remote' | 'llama' {
  if (mockLiteRT.generateRaw.mock.calls.length > 0) return 'litert';
  if (remoteProviderGenerate?.mock.calls.length > 0) return 'remote';
  if (mockLlm.generateResponseWithTools.mock.calls.length > 0) return 'llama';
  throw new Error('no engine leaf was driven');
}

/** The engine the OWNER (engines.ts) names as active — the single source of truth. */
function engineOwnerNames(): 'litert' | 'remote' | 'llama' {
  if (isRemoteTextModelActive()) return 'remote';
  return getActiveEngineService() === liteRTService ? 'litert' : 'llama';
}

function makeCtx(conversationId: string): ToolLoopContext {
  const userMsg: Message = createMessage({ role: 'user', content: 'what is the capital of France' });
  return {
    conversationId,
    messages: [userMsg],
    enabledToolIds: ['web_search'],
    isAborted: () => false,
    onThinkingDone: () => {},
    onStream: () => {},
    onFinalResponse: () => {},
  };
}

/** Register a real provider record shaped like a registered remote provider whose generate() streams a
 *  plain answer (the network boundary). The registry + isRemoteTextModelActive run for real above it. */
function registerRemoteProvider(serverId: string): void {
  remoteProviderGenerate = jest.fn(async (_msgs: unknown, _opts: unknown, cbs: any) => {
    cbs?.onToken?.('Paris');
    cbs?.onComplete?.({ content: 'Paris' });
    return { content: 'Paris', toolCalls: [] };
  });
  const provider = {
    generate: remoteProviderGenerate,
    capabilities: { supportsThinking: false, supportsVision: false, supportsToolCalling: true },
    isReady: async () => true,
    getLoadedModelId: () => 'remote-model',
    loadModel: jest.fn(async () => {}),
  };
  (providerRegistry as any).registerProvider(serverId, provider);
}

beforeEach(() => {
  resetStores();
  jest.clearAllMocks();
  remoteProviderGenerate = undefined as unknown as jest.Mock;
  mockLiteRT.prepareConversation.mockResolvedValue(undefined as never);
  mockLiteRT.generateRaw.mockResolvedValue('Paris');
  (mockLlm.supportsToolCalling as jest.Mock)?.mockReturnValue?.(false);
  mockLlm.generateResponseWithTools.mockResolvedValue({ fullResponse: 'Paris', toolCalls: [] } as never);
});

afterEach(() => {
  // The registry is a process-singleton (resetStores doesn't touch it) — drop any test provider.
  for (const id of (providerRegistry as any).getProviderIds?.() ?? []) {
    if (id !== 'local') (providerRegistry as any).unregisterProvider(id);
  }
});

describe('generationToolLoop routes to the engine the engines.ts owner names', () => {
  it('GUARD (divergence input): a LiteRT model is active but not-yet-loaded — owner names litert, so the loop must route to LiteRT (not llama)', async () => {
    // The inline conflation `engine==='litert' && liteRTService.isModelLoaded()` disagrees with the owner
    // getActiveEngineService() (which does NOT check loaded) exactly here. This is the drift the guard catches.
    mockLlm.isModelLoaded.mockReturnValue(false);
    mockLiteRT.isModelLoaded.mockReturnValue(false); // not loaded → old inline flips to llama; owner stays litert
    useAppStore.setState({
      downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })],
      activeModelId: 'lrt',
    });
    const conversationId = setupWithConversation({ messages: [] });

    await runToolLoop(makeCtx(conversationId));

    expect(engineOwnerNames()).toBe('litert');
    expect(engineTheLoopUsed()).toBe(engineOwnerNames());
  });

  it('LiteRT active and loaded: loop routes to LiteRT, matching getActiveEngineService()', async () => {
    mockLlm.isModelLoaded.mockReturnValue(false);
    mockLiteRT.isModelLoaded.mockReturnValue(true);
    useAppStore.setState({
      downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })],
      activeModelId: 'lrt',
    });
    const conversationId = setupWithConversation({ messages: [] });

    await runToolLoop(makeCtx(conversationId));

    expect(engineOwnerNames()).toBe('litert');
    expect(engineTheLoopUsed()).toBe(engineOwnerNames());
  });

  it('llama active and loaded: loop routes to llama, matching getActiveEngineService()', async () => {
    mockLlm.isModelLoaded.mockReturnValue(true);
    mockLiteRT.isModelLoaded.mockReturnValue(false);
    useAppStore.setState({
      downloadedModels: [createDownloadedModel({ id: 'gg', engine: 'llama' })],
      activeModelId: 'gg',
    });
    const conversationId = setupWithConversation({ messages: [] });

    await runToolLoop(makeCtx(conversationId));

    expect(engineOwnerNames()).toBe('llama');
    expect(engineTheLoopUsed()).toBe(engineOwnerNames());
  });

  it('remote active (server registered, no local loaded): loop routes remote, matching isRemoteTextModelActive()', async () => {
    mockLlm.isModelLoaded.mockReturnValue(false);
    mockLiteRT.isModelLoaded.mockReturnValue(false);
    const serverId = 'srv-1';
    registerRemoteProvider(serverId);
    useRemoteServerStore.setState({ activeServerId: serverId, activeRemoteTextModelId: 'remote-model' } as never);
    useAppStore.setState({ downloadedModels: [], activeModelId: null });
    const conversationId = setupWithConversation({ messages: [] });

    await runToolLoop(makeCtx(conversationId));

    expect(engineOwnerNames()).toBe('remote');
    expect(engineTheLoopUsed()).toBe(engineOwnerNames());
  });
});
