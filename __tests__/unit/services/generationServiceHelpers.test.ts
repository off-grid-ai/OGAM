/**
 * generationServiceHelpers — the speed details a reply is stored with (per engine), getting ready for a
 * reply, and the reply itself, all driven through generationService.generateResponse on a faked device.
 *
 *  - The speed details: a server on the LAN, llama, LiteRT with and without the native benchmark, on the
 *    GPU / NPU / CPU.
 *  - Getting ready: a second send while a reply runs, no model loaded, the native conversation reset failing.
 *  - The reply: LiteRT and llama answers stored; a voice note always goes to LiteRT as its transcript.
 *
 * Real: generationService and its helpers, llmService, liteRTService, activeModelService (loads through the
 * residency lock), the providers and stream parser, the stores. Faked (device / network,
 * harness/generationDevice): llama.rn, the LiteRT native module and its events, the filesystem, RAM, and
 * the LAN server at its XMLHttpRequest.
 */
import {
  launchGeneration,
  connectServer,
  type GenerationDevice,
  type ServerHandle,
} from '../../harness/generationDevice';

const tick = (ms = 0) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function until(check: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await tick(5);
  }
}

let d: GenerationDevice;
let server: ServerHandle | null = null;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
});

afterEach(() => {
  server?.restore();
  server = null;
});

const nativeSends = (dev: GenerationDevice) =>
  dev.boundary.litert.calls.sendMessage.length +
  dev.boundary.litert.calls.sendMessageWithImages.length +
  dev.boundary.litert.calls.sendMessageWithMedia.length;

/** A LiteRT phone whose native engine loaded the model on `backend`. */
async function liteRTOn(backend: 'gpu' | 'npu' | 'cpu', model: Record<string, unknown> = {}) {
  const dev = await launchGeneration({ engine: 'litert', load: false });
  const m = dev.useAppStore.getState().downloadedModels[0];
  dev.useAppStore.getState().setDownloadedModels([{ ...m, ...model }]);
  dev.useAppStore.getState().updateSettings({ liteRTBackend: backend });
  dev.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend, maxNumTokens: 4096 });
  await dev.activeModelService.loadTextModel('m');
  return dev;
}

/** Answer one LiteRT turn token by token, ending with what native reports on litert_complete. */
async function liteRTReply(dev: GenerationDevice, tokens: string[], complete: Record<string, unknown> = {}) {
  dev.boundary.litert.scriptHang();
  const before = nativeSends(dev);
  const reply = dev.generationService.generateResponse(dev.conversationId, dev.ask('hi'));
  await until(() => nativeSends(dev) === before + 1, 'the native send');
  for (const t of tokens) {
    dev.boundary.litertEvents.emit('litert_token', t);
    await tick(15);
  }
  dev.boundary.litertEvents.emit('litert_complete', JSON.stringify(complete));
  await reply;
  return dev.answers().at(-1);
}

// ---------------------------------------------------------------------------
// The speed details stored with a reply
// ---------------------------------------------------------------------------
describe('speed details — a server on the LAN', () => {
  it('stores the server reply as remote, with an estimated token count and the time to the first token', async () => {
    d = await launchGeneration({ localModel: false });
    server = await connectServer(d);
    server.reply({ content: ['hello ', 'world ', 'test'] });

    await d.generationService.generateResponse(d.conversationId, d.ask('hi'));

    const [answer] = d.answers();
    expect(answer.content).toBe('hello world test');
    expect(answer.generationMeta).toEqual(expect.objectContaining({ gpu: false, gpuBackend: 'Remote' }));
    expect(answer.generationMeta.modelName).toEqual(expect.any(String));
    expect(answer.generationMeta.modelName).not.toBe('');
    expect(answer.generationMeta.tokenCount).toBe(Math.ceil('hello world test'.length / 4));
    expect(answer.generationMeta.timeToFirstToken).toEqual(expect.any(Number));
  });
});

describe('speed details — llama', () => {
  it('stores what llama measured, the backend it ran on and the cache type', async () => {
    d = await launchGeneration();
    d.useAppStore.getState().updateSettings({ cacheType: 'q8_0' });
    d.boundary.llama!.scriptCompletion({ text: 'Hi there.' });

    await d.generationService.generateResponse(d.conversationId, d.ask('hi'));

    const [answer] = d.answers();
    expect(answer.content).toBe('Hi there.');
    const gpuInfo = d.llmService.getGpuInfo();
    const perf = d.llmService.getPerformanceStats();
    expect(answer.generationMeta).toEqual(expect.objectContaining({
      modelName: 'Test Model',
      gpu: gpuInfo.gpu,
      gpuBackend: gpuInfo.gpuBackend,
      tokenCount: perf.lastTokenCount,
      tokensPerSecond: perf.lastTokensPerSecond,
      cacheType: 'q8_0',
    }));
    expect(answer.generationMeta.tokenCount).toBeGreaterThan(0);
  });
});

describe('speed details — LiteRT', () => {
  it('stores the prompt token count native reported and the speed timed on the stream, on the GPU', async () => {
    d = await liteRTOn('gpu');

    const answer = await liteRTReply(d, ['hello', ' world'], { prefillTokenCount: 128, decodeTokenCount: 2 });

    expect(answer.content).toBe('hello world');
    expect(answer.generationMeta).toEqual(expect.objectContaining({
      modelName: 'Test Model',
      gpu: true,
      gpuBackend: 'GPU',
      tokenCount: 128,
    }));
    // Timed from the send to the first token, and over the tokens that followed.
    expect(answer.generationMeta.timeToFirstToken).toBeGreaterThan(0);
    expect(answer.generationMeta.decodeTokensPerSecond).toBeGreaterThan(0);
  });

  it('marks an NPU turn as accelerated', async () => {
    d = await liteRTOn('npu');

    const answer = await liteRTReply(d, ['ok'], { ttft: 0.2, decodeTokensPerSecond: 30, prefillTokenCount: 64 });

    expect(answer.generationMeta).toEqual(expect.objectContaining({ gpu: true, gpuBackend: 'NPU' }));
  });

  it('estimates the tokens and speed of a reply stopped before native reported anything, on the CPU', async () => {
    d = await liteRTOn('cpu', { name: 'Gemma-3' });
    const text = 'abcd'.repeat(10);
    d.boundary.litert.scriptPartialThenHang(text);
    const reply = d.generationService.generateResponse(d.conversationId, d.ask('hi'));
    await until(() => d.useChatStore.getState().streamingMessage === text, 'the partial on screen');
    await tick(20);

    await d.generationService.stopGeneration();
    await reply;

    const [answer] = d.answers();
    expect(answer.content).toBe(text);
    expect(answer.generationMeta).toEqual(expect.objectContaining({
      modelName: 'Gemma-3',
      gpu: false,
      gpuBackend: 'CPU',
      tokenCount: Math.ceil(text.length / 4),
    }));
    expect(answer.generationMeta.tokensPerSecond).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Getting ready for a reply
// ---------------------------------------------------------------------------
describe('getting ready for a reply', () => {
  it('a second send while a reply runs sends nothing more to native', async () => {
    d = await liteRTOn('cpu');
    d.boundary.litert.scriptHang();
    const first = d.generationService.generateResponse(d.conversationId, d.ask('one'));
    await until(() => nativeSends(d) === 1, 'the first native send');

    await d.generationService.generateResponse(d.conversationId, d.ask('two'));

    expect(nativeSends(d)).toBe(1);
    expect(d.generationService.getState().isGenerating).toBe(true);
    d.boundary.litertEvents.emit('litert_complete', '{}');
    await first;
  });

  it('refuses a LiteRT reply when the model is not loaded, and leaves nothing streaming', async () => {
    d = await launchGeneration({ engine: 'litert', load: false });
    const loads = d.boundary.litert.calls.loadModel.length;
    d.boundary.litert.module.loadModel.mockRejectedValue(new Error('native load refused'));

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('hi'))).rejects.toThrow();

    expect(d.boundary.litert.calls.loadModel.length).toBeGreaterThanOrEqual(loads);
    expect(nativeSends(d)).toBe(0);
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
  });

  it('refuses a llama reply when the model is not loaded, and leaves nothing streaming', async () => {
    d = await launchGeneration({ load: false });
    d.boundary.llama!.scriptInitFailure(true);

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('hi'))).rejects.toThrow();

    expect(d.boundary.llama!.calls.completion).toHaveLength(0);
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
  });

  it('clears the reply state when the native conversation reset fails', async () => {
    d = await launchGeneration();
    d.nativeContext()!.clearCache.mockRejectedValueOnce(new Error('Conversation preparation failed'));

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('hi')))
      .rejects.toThrow('Conversation preparation failed');

    expect(d.boundary.llama!.calls.completion).toHaveLength(0);
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
    expect(d.useChatStore.getState().streamingMessage).toBe('');
  });
});

// ---------------------------------------------------------------------------
// The reply
// ---------------------------------------------------------------------------
describe('the reply', () => {
  const voiceNote = [{ id: 'a', type: 'audio' as const, uri: 'file:///clip.wav' }];

  // PRODUCT RULE (modelMedia single source): a voice note is transcript-only; its audio is NEVER model
  // input, on any engine, even for a model that takes audio.
  it('sends a voice note to an audio-capable LiteRT model as its transcript, never as audio', async () => {
    d = await liteRTOn('cpu', { liteRTAudio: true });
    d.boundary.litert.scriptTurn({ content: 'Heard you.' });

    await d.generationService.generateResponse(d.conversationId, d.ask('the transcript', voiceNote));

    expect(d.boundary.litert.calls.sendMessage.map(args => args[0])).toEqual(['the transcript']);
    expect(d.boundary.litert.calls.sendMessageWithMedia).toHaveLength(0);
    expect(d.answers().map((m: any) => m.content)).toEqual(['Heard you.']);
  });

  it('does not refuse a voice note on a LiteRT model without audio: it sends the transcript (B5/B9)', async () => {
    d = await liteRTOn('cpu', { liteRTAudio: false });
    d.boundary.litert.scriptTurn({ content: 'Got it.' });

    await d.generationService.generateResponse(d.conversationId, d.ask('the transcript', voiceNote));

    expect(d.boundary.litert.calls.sendMessage.map(args => args[0])).toEqual(['the transcript']);
    expect(d.answers().map((m: any) => m.content)).toEqual(['Got it.']);
  });

  it('stores a llama answer with the reasoning the model streamed beside it', async () => {
    d = await launchGeneration();
    d.useAppStore.getState().updateSettings({ thinkingEnabled: true });
    d.boundary.llama!.scriptCompletion({ text: 'hello', reasoning: 'thinking' });

    await d.generationService.generateResponse(d.conversationId, d.ask('hi'));

    const [answer] = d.answers();
    expect(answer.content).toBe('hello');
    expect(answer.reasoningContent).toBe('thinking');
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
  });
});
