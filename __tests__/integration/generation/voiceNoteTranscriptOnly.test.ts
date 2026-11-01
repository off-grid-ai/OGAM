/**
 * Intersection journey: a voice note is TRANSCRIPT-ONLY on EVERY text engine (B5/B9 parity).
 *
 * Product rule (single source of truth): every voice note is transcribed and ONLY its transcript
 * (already in message.content) is sent to the model. The audio attachment is display/playback only,
 * NEVER model input — sending it is redundant AND its absolute path goes stale on reinstall
 * ("File does not exist" — B9), and a non-audio model rejects it ("Failed to load media" — B5).
 *
 * Why this test exists: the B5/B9 fix was applied to the llama/OAI path (llmMessages.ts) but the
 * LiteRT generation path (runLiteRTResponseImpl) extracted audioUris independently and either sent
 * the audio to an audio-capable model OR THREW "does not support audio input" for a non-audio one —
 * the same bug, on the other engine, uncaught because no test crossed voice-note × litert. This is
 * the engine × modality intersection (see docs/TEST_MATRIX.md).
 *
 * Real: generationService, llmService, liteRTService, activeModelService, the stores. Faked, because
 * they are the phone: llama.rn, the LiteRT native module, the disk and RAM (generationDevice). What
 * the native engine received is the assertion.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

const voiceNote = (uri: string, transcript: string) =>
  ({ id: `a-${uri}`, type: 'audio' as const, uri, audioFormat: 'wav', textContent: transcript });

type EngineCase = { engine: 'llama' | 'litert'; audioCapable: boolean; label: string };
const ENGINE_CASES: EngineCase[] = [
  { engine: 'llama', audioCapable: false, label: 'llama (GGUF)' },
  { engine: 'litert', audioCapable: false, label: 'litert, NON-audio model' },
  { engine: 'litert', audioCapable: true, label: 'litert, audio-capable model' },
];

/** A downloaded model, pre-placed as a finished download leaves it, then selected and loaded. */
async function installModel(device: GenerationDevice, engine: 'llama' | 'litert', audioCapable: boolean) {
  const fileName = engine === 'llama' ? 'text-1.gguf' : 'text-1.litertlm';
  const filePath = `${device.boundary.fs!.DocumentDirectoryPath}/models/${fileName}`;
  device.boundary.fs!.seedFile(filePath, 500 * 1024 * 1024);
  device.useAppStore.getState().addDownloadedModel(createDownloadedModel({
    id: 'text-1', name: 'Text One', engine, filePath, fileName, fileSize: 2 * GB, liteRTAudio: audioCapable,
  }));
  device.activeModelService.selectTextModel('text-1');
  await device.activeModelService.loadTextModel('text-1');
}

describe.each(ENGINE_CASES)('voice note is transcript-only — engine=$label', ({ engine, audioCapable }) => {
  it('sends the TRANSCRIPT and never the audio as model input (no throw for non-audio models)', async () => {
    const device = await launchGeneration({ localModel: false });
    await installModel(device, engine, audioCapable);
    const litert = device.boundary.litert;
    const llama = device.boundary.llama!;
    litert.scriptTurn({ content: 'ok' });
    llama.scriptCompletion({ text: 'ok' });
    const litertSentBefore = litert.calls.sendMessage.length; // a LiteRT load runs its own warm-up turn
    const llamaRunsBefore = llama.calls.completion.length;

    const conversationId = device.useChatStore.getState().createConversation('text-1');
    device.useChatStore.getState().addMessage(conversationId, {
      role: 'user',
      content: 'what is the capital of France', // the transcript lives in content
      attachments: [voiceNote('/stale/container/abc/Documents/vn.wav', 'what is the capital of France')],
    });
    const thread = device.useChatStore.getState().getConversationMessages(conversationId);

    // Must NOT throw (the non-audio litert model used to reject the voice note outright).
    await expect(device.generationService.generateResponse(conversationId, thread)).resolves.not.toThrow();

    if (engine === 'litert') {
      // Terminal artifact: the LiteRT engine received the transcript text and no audio.
      const turn = litert.calls.sendMessage.slice(litertSentBefore);
      expect(turn).toHaveLength(1);
      expect(turn[0][0]).toBe('what is the capital of France');
      expect(litert.module.sendMessageWithAudio).not.toHaveBeenCalled();
      expect(litert.calls.sendMessageWithMedia).toHaveLength(0);
    } else {
      // llama: the turn reaches the engine and COMPLETES without a media-load failure (audio-media
      // stripping itself is unit-tested in llmMessages).
      expect(llama.calls.completion.length).toBeGreaterThan(llamaRunsBefore);
    }
    // The turn finalized: the answer is in the chat and nothing is still generating.
    const answers = device.useChatStore.getState().getConversationMessages(conversationId)
      .filter((m: { role: string }) => m.role === 'assistant');
    expect(answers.map((m: { content: string }) => m.content)).toEqual(['ok']);
    expect(device.generationService.getState().isGenerating).toBe(false);
  });
});
