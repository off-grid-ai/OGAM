/**
 * RED-FLOW: engine-parity bugs — Q17 (see docs/DEVICE_TEST_LOG.md).
 *
 * Drives the REAL runToolLoop → callLiteRTForLoop (our code) with a LiteRT model active and a tool
 * enabled; the ONLY things stubbed are the native leaves llmService/liteRTService (data + arg
 * recorders). Asserts the CORRECT behavior (transcript-only: audioUris === []) and is RED on HEAD
 * because callLiteRTForLoop derives audioUris inline instead of via modelMedia. it.failing carrier:
 * green while the bug is live, flips red when the fix lands. Delete `.failing` to see the real red.
 */
jest.mock('../../../src/services/llm');
jest.mock('../../../src/services/litert');

import { runToolLoop, type ToolLoopContext } from '../../../src/services/generationToolLoop';
import { liteRTService } from '../../../src/services/litert';
import { llmService } from '../../../src/services/llm';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores, setupWithConversation } from '../../utils/testHelpers';
import { createDownloadedModel, createMessage } from '../../utils/factories';
import type { MediaAttachment, Message } from '../../../src/types';

const mockLiteRT = liteRTService as jest.Mocked<typeof liteRTService>;
const mockLlm = llmService as jest.Mocked<typeof llmService>;

const voiceNote = (uri: string, transcript: string): MediaAttachment =>
  ({ id: `a-${uri}`, type: 'audio', uri, audioFormat: 'wav', textContent: transcript } as MediaAttachment);

beforeEach(() => {
  resetStores();
  jest.clearAllMocks();
  // Native boundary: llama NOT loaded, litert loaded — data-only stubs.
  mockLlm.isModelLoaded.mockReturnValue(false);
  (mockLlm.supportsToolCalling as jest.Mock)?.mockReturnValue?.(false);
  mockLiteRT.isModelLoaded.mockReturnValue(true);
  mockLiteRT.prepareConversation.mockResolvedValue(undefined as never);
  mockLiteRT.generateRaw.mockResolvedValue('Paris'); // plain answer, no tool call → loop ends
  // Active model = LiteRT, so getActiveEngineService()===liteRTService (isLiteRTActive() true).
  useAppStore.setState({
    downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })],
    activeModelId: 'lrt',
  });
});

describe('engine parity — red-flow (correct behavior; currently RED)', () => {
  it('Q17: a voice note + a tool enabled on LiteRT sends the TRANSCRIPT and NO audio to generateRaw', async () => {
    const conversationId = setupWithConversation({ messages: [] });
    const userMsg: Message = createMessage({
      role: 'user',
      content: 'what is the capital of France', // transcript already in content
      attachments: [voiceNote('/stale/container/xyz/Documents/vn.wav', 'what is the capital of France')],
    });

    const ctx: ToolLoopContext = {
      conversationId,
      messages: [userMsg],
      enabledToolIds: ['web_search'],
      isAborted: () => false,
      onThinkingDone: () => {},
      onStream: () => {},
      onFinalResponse: () => {},
    };

    await runToolLoop(ctx);

    expect(mockLiteRT.generateRaw).toHaveBeenCalled();
    const [text, media] = mockLiteRT.generateRaw.mock.calls[0];
    expect(text).toContain('what is the capital of France');
    // Correct: audio is transcript-only, never model input. Today: ['/stale/.../vn.wav'].
    expect((media as { audioUris?: string[] })?.audioUris ?? []).toEqual([]);
  });
});
