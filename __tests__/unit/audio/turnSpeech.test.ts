/**
 * turnSpeech — the single "speak a completed assistant turn" owner. Verifies it speaks the final
 * assistant message in voice mode (warming the engine via the store's speak, never pre-gating on
 * isReady), flushes the streamed partial when streaming was active, bails outside audio mode / on
 * non-speakable messages, and that the image-generation state machine drives it on the transition
 * to 'done'.
 *
 * Real: turnSpeech, the TTS store, the Kokoro engine and its executorch bridge (mounted as the app
 * mounts it), streamingSpeech, the chat store, imageGenerationService, activeModelService and the
 * residency manager. Faked, because they are the phone: ExecuTorch's resource fetcher and its
 * useTextToSpeech hook (which records what it is asked to say), llama.rn, the image-generation native
 * module, the disk and RAM (harness/generationDevice).
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { requireRTL } from '../../harness/nativeBoundary';
import { SD_MNN_PACKAGE_FILES } from '../../harness/imageModelPackage';

type TurnSpeechModule = typeof import('../../../pro/audio/turnSpeech');
type StreamingModule = typeof import('../../../pro/audio/streamingSpeech');
type TtsStoreModule = typeof import('../../../pro/audio/ttsStore');

let device: GenerationDevice;
let turnSpeech: TurnSpeechModule;
let streaming: StreamingModule;
let useTTSStore: TtsStoreModule['useTTSStore'];
let spoken: string[];
let unmountBridge: () => void;

beforeEach(async () => {
  device = await launchGeneration({ engine: 'llama' });
  require('../../harness/kokoroResourceBoundary').installKokoroResourceBoundary().seedVoice();
  spoken = [];
  // A bridge mounted with preventLoad holds no model (not ready), as executorch's hook does.
  require('react-native-executorch').useTextToSpeech = (_config: unknown, opts?: { preventLoad?: boolean }) => ({
    isReady: !opts?.preventLoad, downloadProgress: opts?.preventLoad ? 0 : 1, error: null,
    stream: async ({ text }: { text: string }) => { spoken.push(text); },
    streamStop: () => {},
  });
  ({ useTTSStore } = require('../../../pro/audio/ttsStore') as TtsStoreModule);
  turnSpeech = require('../../../pro/audio/turnSpeech');
  streaming = require('../../../pro/audio/streamingSpeech');
  // Voice mode with Kokoro downloaded, as the voice settings leave it.
  await useTTSStore.getState().setEngine('kokoro');
  await useTTSStore.getState().downloadModels();
  useTTSStore.getState().updateSettings({ interfaceMode: 'audio', enabled: true });
  const rtl = requireRTL();
  const React = require('react');
  // The app root mounts the active engine's executorch bridge through EngineBridge.
  const { EngineBridge } = require('../../../pro/audio/ui/EngineBridge');
  ({ unmount: unmountBridge } = rtl.render(React.createElement(EngineBridge)));
});

afterEach(async () => {
  useTTSStore.getState().stop();
  streaming.resetStreamingSpeech();
  unmountBridge();
});

const lastMessage = () => device.thread().at(-1)!;

function reply(content: string, extra: Record<string, unknown> = {}) {
  device.ask('draw a horse');
  device.useChatStore.getState().addMessage(device.conversationId, { role: 'assistant', content, ...extra });
  return lastMessage();
}

async function untilSpoken(count: number) {
  const rtl = requireRTL();
  await rtl.waitFor(() => expect(spoken.length).toBeGreaterThanOrEqual(count));
}

describe('speakCompletedTurn', () => {
  it('speaks the final assistant message in audio mode even when the engine is cold (no isReady pre-gate)', async () => {
    const message = reply('Here is your horse.');
    // The engine was released (e.g. evicted to fit the image model): it is cold.
    await requireRTL().act(async () => { await useTTSStore.getState().releaseEngine(); });
    expect(useTTSStore.getState().isReady).toBe(false);

    turnSpeech.speakCompletedTurn(device.conversationId);

    await untilSpoken(1);
    expect(spoken).toEqual(['Here is your horse.']);
    expect(lastMessage()).toEqual(expect.objectContaining({ id: message.id, isAudioModeMessage: true }));
  });

  it('bails when not in audio mode', async () => {
    useTTSStore.getState().updateSettings({ interfaceMode: 'chat' });
    reply('Here is your horse.');

    turnSpeech.speakCompletedTurn(device.conversationId);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(spoken).toEqual([]);
    expect(lastMessage().isAudioModeMessage).toBeUndefined();
  });

  it('flushes the streamed partial (does not re-speak) when streaming was active', async () => {
    await useTTSStore.getState().initializeEngine();
    streaming.feedStreamingText('Here is your horse. It is brown');
    await untilSpoken(1);
    expect(streaming.isStreamingSpeechActive()).toBe(true);
    reply('Here is your horse. It is brown');

    turnSpeech.speakCompletedTurn(device.conversationId);

    await untilSpoken(2);
    expect(spoken).toEqual(['Here is your horse.', 'It is brown']);
  });

  it('bails on a non-speakable last message (system info)', async () => {
    reply('Model loaded', { isSystemInfo: true });

    turnSpeech.speakCompletedTurn(device.conversationId);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(spoken).toEqual([]);
  });

  it('bails on a voice note that already has audio', async () => {
    reply('Here is your horse.', { audioPath: '/docs/a.wav' });

    turnSpeech.speakCompletedTurn(device.conversationId);
    await new Promise(resolve => setTimeout(resolve, 50));

    expect(spoken).toEqual([]);
  });
});

describe('initTurnSpeech (image generation → speak)', () => {
  /** A downloaded image model, as a finished download leaves it, selected for image generation. */
  async function setupImageModel() {
    const { modelManager } = require('../../../src/services/modelManager');
    const modelPath = `${modelManager.getImageModelsDirectory()}/img-model-1`;
    for (const name of SD_MNN_PACKAGE_FILES) device.boundary.fs!.seedFile(`${modelPath}/${name}`, 1024 * 1024);
    const model = { id: 'img-model-1', name: 'Image Model', description: '', size: 500 * 1024 * 1024, modelPath, backend: 'mnn' };
    await modelManager.addDownloadedImageModel(model);
    device.useAppStore.getState().addDownloadedImageModel(model);
    device.useAppStore.getState().setActiveImageModelId('img-model-1');
    device.useAppStore.getState().updateSettings({
      imageSteps: 20, imageGuidanceScale: 7.5, imageWidth: 512, imageHeight: 512, imageThreads: 4,
      enhanceImagePrompts: false,
    } as never);
  }

  // FINDING: 'done' is announced before the result message is in the chat, so the turn is not spoken.
  it.failing('speaks the result once when image generation transitions to done', async () => {
    const stop = turnSpeech.initTurnSpeech();
    await setupImageModel();
    const { imageGenerationService } = require('../../../src/services/imageGenerationService');
    device.ask('draw a horse');

    await imageGenerationService.generateImage({ prompt: 'a horse', conversationId: device.conversationId });

    const result = lastMessage();
    expect(result.role).toBe('assistant');
    await untilSpoken(1);
    expect(result.content).toBe('Generated image for: "a horse"');
    expect(spoken).toEqual([expect.stringContaining('Generated image for:')]);
    // Staying in done does not speak it again.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(spoken).toHaveLength(1);
    stop();
  });
});
