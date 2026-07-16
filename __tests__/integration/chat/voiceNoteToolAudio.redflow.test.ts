/**
 * RED-FLOW (integration) — Q17, rebuilt on the harness (the prior carrier mocked our own liteRTService —
 * "mocked too high"). A voice note + a tool enabled on LiteRT: the tool-loop derives audioUris inline and
 * sends the note's AUDIO to the model instead of the transcript (generationToolLoop.ts callLiteRTForLoop),
 * so native gets a stale/gone file path → device crash ("File does not exist").
 *
 * Real runToolLoop + real liteRTService; only the native LiteRTModule is faked (records what audio the
 * native layer received). UI manifestation is a device-only native crash, so the honest jest ceiling is
 * "what reached the native boundary" — audioUris must be [] (transcript-only).
 */
import { installNativeBoundary } from '../../harness/nativeBoundary';
import { createDownloadedModel, createMessage } from '../../utils/factories';
import type { MediaAttachment, Message } from '../../../src/types';

describe('Q17 (harness) — voice note + tool on LiteRT sends audio to native (red-flow)', () => {
  it('sends the transcript and NO audio to the native LiteRT model', async () => {
    const boundary = installNativeBoundary({ ram: { platform: 'android', totalBytes: 12 * 1024 ** 3, availBytes: 8 * 1024 ** 3 } });
    /* eslint-disable @typescript-eslint/no-var-requires */
    const { liteRTService } = require('../../../src/services/litert');
    const { runToolLoop } = require('../../../src/services/generationToolLoop');
    const { useAppStore, useChatStore } = require('../../../src/stores');
    /* eslint-enable @typescript-eslint/no-var-requires */

    await liteRTService.loadModel('/models/gemma.litertlm', 'gpu', { maxNumTokens: 4096 });
    useAppStore.setState({ downloadedModels: [createDownloadedModel({ id: 'lrt', engine: 'litert' })], activeModelId: 'lrt' });
    boundary.litert.scriptTurn({ content: 'Paris' });

    const voiceNote: MediaAttachment = { id: 'a1', type: 'audio', uri: '/stale/container/vn.wav', audioFormat: 'wav', textContent: 'what is the capital of France' } as MediaAttachment;
    const userMsg: Message = createMessage({ role: 'user', content: 'what is the capital of France', attachments: [voiceNote] });
    const conversationId = useChatStore.getState().createConversation('lrt');

    await runToolLoop({
      conversationId, messages: [userMsg], enabledToolIds: ['web_search'],
      isAborted: () => false, onThinkingDone: () => {}, onStream: () => {}, onFinalResponse: () => {},
    });

    // The native layer must have received the TRANSCRIPT with NO audio uris. Today the tool-loop passes
    // the voice note's audio inline → native gets ['/stale/.../vn.wav'] → "File does not exist" → RED.
    const audioCalls = [
      ...boundary.litert.module.sendMessageWithAudio.mock.calls,
      ...boundary.litert.calls.sendMessageWithMedia,
    ];
    const audioSentToNative = audioCalls.flatMap(c => (Array.isArray(c[c.length - 1]) ? c[c.length - 1] : c[1]) ?? []);
    expect(audioSentToNative).toEqual([]);
  });
});
