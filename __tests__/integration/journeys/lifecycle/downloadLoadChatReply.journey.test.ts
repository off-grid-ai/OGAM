/**
 * JOURNEY — download a text model → load → send a message → get a reply (cluster A).
 *
 * The end-to-end spine: a downloaded model is registered in the store, loaded through
 * the REAL activeModelService (residency-gated), then a chat turn runs through the
 * REAL generationService + chatStore, and the terminal artifact — the FINALIZED
 * assistant chat message — is asserted (not "generateResponse was called").
 *
 * Only the native llama engine and the RAM sensor are mocked at the boundary. The
 * mocked engine streams tokens through the real token callback and fires the done
 * callback, so the real generationService buffering + chatStore.finalizeStreamingMessage
 * run for real. Residency state (getResidents()) is asserted after the load step.
 */

import { Platform } from 'react-native';
import { useAppStore } from '../../../../src/stores/appStore';
import { useChatStore } from '../../../../src/stores/chatStore';
import { activeModelService } from '../../../../src/services/activeModelService';
import { generationService } from '../../../../src/services/generationService';
import { modelResidencyManager } from '../../../../src/services/modelResidency';
import { llmService } from '../../../../src/services/llm';
import { hardwareService } from '../../../../src/services/hardware';
import {
  resetStores,
  flushPromises,
  getChatState,
} from '../../../utils/testHelpers';
import {
  createDownloadedModel,
  createConversation,
  createUserMessage,
  createDeviceInfo,
} from '../../../utils/factories';

jest.mock('../../../../src/services/llm');
jest.mock('../../../../src/services/litert');
jest.mock('../../../../src/services/localDreamGenerator');
jest.mock('../../../../src/services/hardware');

const mockLlm = llmService as jest.Mocked<typeof llmService>;
const mockHw = hardwareService as jest.Mocked<typeof hardwareService>;

const originalOS = Platform.OS;

const textModel = () =>
  createDownloadedModel({
    id: 'text-1',
    engine: 'llama' as any,
    fileName: 'text.gguf',
    filePath: '/text.gguf',
    fileSize: 3 * 1024 * 1024 * 1024,
  });

describe('JOURNEY: download → load → send → reply', () => {
  beforeEach(async () => {
    resetStores();
    jest.clearAllMocks();
    modelResidencyManager._reset();

    let llmLoaded = false;
    mockLlm.isModelLoaded.mockImplementation(() => llmLoaded);
    mockLlm.getLoadedModelPath.mockImplementation(() => (llmLoaded ? '/text.gguf' : null));
    mockLlm.loadModel.mockImplementation(async () => {
      llmLoaded = true;
    });
    mockLlm.unloadModel.mockImplementation(async () => {
      llmLoaded = false;
    });
    mockLlm.getMultimodalSupport.mockReturnValue({ vision: false } as any);
    mockLlm.isCurrentlyGenerating.mockReturnValue(false);
    mockLlm.supportsToolCalling.mockReturnValue(false);
    mockLlm.supportsThinking.mockReturnValue(false);
    mockLlm.isGemma4Model.mockReturnValue(false);
    mockLlm.isThinkingEnabled.mockReturnValue(false);
    mockLlm.getGpuInfo.mockReturnValue({ gpu: false, gpuBackend: null, gpuLayers: 0 } as any);
    mockLlm.getPerformanceStats.mockReturnValue({} as any);
    // The engine streams a reply through the real token callback, then signals done.
    mockLlm.generateResponse.mockImplementation(
      async (_messages: any, onToken: any, onDone: any) => {
        onToken({ content: 'Hello ' });
        onToken({ content: 'there.' });
        onDone?.();
        return 'Hello there.';
      },
    );

    mockHw.getDeviceInfo.mockResolvedValue(
      createDeviceInfo({ totalMemory: 12 * 1024 * 1024 * 1024 }),
    );
    mockHw.refreshMemoryInfo.mockResolvedValue({} as any);
    mockHw.getTotalMemoryGB.mockReturnValue(12);
    mockHw.getAvailableMemoryGB.mockReturnValue(8);
    mockHw.estimateModelRam.mockImplementation(
      (m: any, mult = 1.5) => (m?.fileSize || m?.size || 0) * mult,
    );
    mockHw.getModelTotalSize.mockImplementation(
      (m: any) => m?.fileSize || m?.size || 0,
    );

    Platform.OS = 'ios' as typeof Platform.OS;
    modelResidencyManager.setLoadPolicy('balanced');
    await activeModelService.syncWithNativeState();
  });

  afterEach(() => {
    modelResidencyManager.setBudgetOverrideMB(null);
    Platform.OS = originalOS;
  });

  it('a freshly downloaded text model loads (resident + registered) then answers a message with a finalized chat reply', async () => {
    // 1. Download completed → the model is registered in the store.
    useAppStore.setState({ downloadedModels: [textModel()] });
    expect(
      useAppStore.getState().downloadedModels.find(m => m.id === 'text-1'),
    ).toBeTruthy();

    // 2. Load it — through residency.
    await activeModelService.loadTextModel('text-1');
    expect(modelResidencyManager.isResident('text')).toBe(true);
    expect(useAppStore.getState().activeModelId).toBe('text-1');
    expect(mockLlm.isModelLoaded()).toBe(true);

    // 3. Send a message.
    const convId = createConversation({ id: 'c1' }).id;
    useChatStore.setState({ conversations: [createConversation({ id: 'c1' })] });
    const userMsg = createUserMessage('hi');
    useChatStore.getState().addMessage('c1', { role: 'user', content: 'hi' });

    await generationService.generateResponse('c1', [userMsg]);
    await flushPromises();

    // TERMINAL ARTIFACT: a finalized assistant message with the streamed reply.
    const msgs = getChatState().conversations.find(c => c.id === convId)?.messages ?? [];
    const assistant = msgs.filter(m => m.role === 'assistant');
    expect(assistant).toHaveLength(1);
    expect(assistant[0].content).toContain('Hello there.');
    // Not still streaming, model still resident.
    expect(getChatState().streamingMessage).toBe('');
    expect(modelResidencyManager.isResident('text')).toBe(true);
  });
});
