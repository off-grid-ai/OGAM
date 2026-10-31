/**
 * generationServiceHelpers / generationRemoteHelpers — the engine-specific halves of a reply, driven
 * through generationService on a faked device.
 *
 *  - LiteRT (Android .litertlm): the vision guard, streaming tokens and reasoning, the first-token flip,
 *    the speed details, a native error, a Stop mid-reply, a native rejection that lands after Stop.
 *  - A server on the LAN: a second tool turn while one is running, a reply with text before a tool call.
 *
 * Real: generationService and both helper modules, liteRTService, activeModelService (load through the
 * residency lock), the tool loop and calculator, the provider and stream parser, the stores. Faked (device
 * / network, harness/generationDevice): the LiteRT native module and its events, llama.rn, the filesystem,
 * RAM, and the LAN server at its XMLHttpRequest.
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

const image = { id: 'i', type: 'image' as const, uri: 'file:///pic.png' };
// Loading a LiteRT model warms it with one native "Hi" turn; count the sends after that.
let warmSends = 0;
const sent = (dev: GenerationDevice) =>
  dev.boundary.litert.calls.sendMessage.length + dev.boundary.litert.calls.sendMessageWithImages.length - warmSends;
async function launchLiteRT(opts: { liteRTVision?: boolean } = {}) {
  const dev = await launchGeneration({ engine: 'litert', ...opts });
  warmSends = 0;
  warmSends = sent(dev);
  return dev;
}

// ---------------------------------------------------------------------------
// LiteRT — the vision guard
// ---------------------------------------------------------------------------
describe('LiteRT — image support guard', () => {
  it('refuses an image for a model without vision, before anything reaches the device', async () => {
    d = await launchLiteRT({ liteRTVision: false });

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('look', [image])))
      .rejects.toThrow(/does not support images/);

    expect(sent(d)).toBe(0);
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
  });

  it('sends the image to a model with vision and stores its answer', async () => {
    d = await launchLiteRT({ liteRTVision: true });
    d.boundary.litert.scriptTurn({ content: 'A cat.' });

    await d.generationService.generateResponse(d.conversationId, d.ask('look', [image]));

    expect(d.boundary.litert.calls.sendMessageWithImages).toEqual([['look', ['file:///pic.png']]]);
    expect(d.answers().map((m: any) => m.content)).toEqual(['A cat.']);
  });
});

// ---------------------------------------------------------------------------
// LiteRT — streaming
// ---------------------------------------------------------------------------
describe('LiteRT — streaming', () => {
  it('flips thinking off at the first token, streams every token, and stores the answer with its speed', async () => {
    d = await launchLiteRT();
    d.boundary.litert.scriptHang(); // the native side answers token by token, driven below
    let firstTokens = 0;

    const reply = d.generationService.generateResponse(
      d.conversationId, d.ask('hi'), () => { firstTokens += 1; },
    );
    await until(() => sent(d) === 1, 'the native send');
    expect(d.generationService.getState().isThinking).toBe(true);

    d.boundary.litertEvents.emit('litert_token', 'he');
    expect(d.generationService.getState().isThinking).toBe(false);
    await tick(20);
    d.boundary.litertEvents.emit('litert_token', 'llo');
    await until(() => d.useChatStore.getState().streamingMessage === 'hello', 'the streamed tokens');
    d.boundary.litertEvents.emit('litert_complete', JSON.stringify({ prefillTokenCount: 4, decodeTokenCount: 2 }));
    await reply;

    expect(firstTokens).toBe(1);
    const [answer] = d.answers();
    expect(answer.content).toBe('hello');
    expect(answer.generationMeta).toEqual(expect.objectContaining({
      modelName: 'Test Model',
      gpu: true,
      gpuBackend: 'GPU',
      tokenCount: 4,
      timeToFirstToken: expect.any(Number),
      decodeTokensPerSecond: expect.any(Number),
    }));
    expect(answer.generationMeta.decodeTokensPerSecond).toBeGreaterThan(0);
    expect(d.generationService.getState().isGenerating).toBe(false);
  });

  it('keeps the reasoning the model thinks beside the answer', async () => {
    d = await launchLiteRT();
    d.boundary.litert.scriptTurn({ reasoning: 'thinking...', content: 'answer' });

    await d.generationService.generateResponse(d.conversationId, d.ask('hi'));

    const [answer] = d.answers();
    expect(answer.content).toBe('answer');
    expect(answer.reasoningContent).toBe('thinking...');
  });

  it('with no question in the thread, sends nothing and resets', async () => {
    d = await launchLiteRT();

    await d.generationService.generateResponse(d.conversationId, [
      { id: 's', role: 'system', content: 'You are helpful.', timestamp: 0 },
    ]);

    expect(sent(d)).toBe(0);
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
    expect(d.answers()).toEqual([]);
  });

  it('raises a native error (B23: the compiled model failed to run) and keeps a failed turn', async () => {
    d = await launchLiteRT();
    d.boundary.litert.scriptError('Status 13 Failed to invoke the compiled model');

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('hi')))
      .rejects.toThrow('Status 13 Failed to invoke the compiled model');

    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.answers().map((m: any) => [m.content, m.turnStatus])).toEqual([['', 'failed']]);
  });
});

// ---------------------------------------------------------------------------
// LiteRT — Stop
// ---------------------------------------------------------------------------
describe('LiteRT — Stop', () => {
  it('keeps the shown partial with an estimated speed, and drops what the device sends after', async () => {
    d = await launchLiteRT();
    d.boundary.litert.scriptPartialThenHang('Partial');

    const reply = d.generationService.generateResponse(d.conversationId, d.ask('hi'));
    await until(() => d.generationService.getState().streamingContent === 'Partial', 'the partial');
    expect(await d.generationService.stopGeneration()).toBe('Partial');
    d.boundary.litertEvents.emit('litert_token', ' late');
    d.boundary.litertEvents.emit('litert_thinking', 'late');
    d.boundary.litertEvents.emit('litert_complete', '{}');
    await reply;
    await tick(80);

    const [answer] = d.answers();
    expect([answer.content, answer.turnStatus]).toEqual(['Partial', 'cancelled']);
    expect(answer.reasoningContent).toBeUndefined();
    expect(answer.generationMeta).toEqual(expect.objectContaining({ gpuBackend: 'GPU', tokenCount: 2 }));
    expect(d.useChatStore.getState().streamingMessage).toBe('');
    expect(d.answers()).toHaveLength(1);
  });

  it('does not raise a native send that fails after Stop', async () => {
    d = await launchLiteRT();
    let fail: (e: Error) => void = () => {};
    d.boundary.litert.module.sendMessage.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { fail = reject; }),
    );

    const reply = d.generationService.generateResponse(d.conversationId, d.ask('hi'));
    await until(() => d.boundary.litert.module.sendMessage.mock.calls.length === warmSends + 1, 'the native send');
    await d.generationService.stopGeneration();
    fail(new Error('aborted mid-flight'));

    await expect(reply).resolves.toBeUndefined();
    expect(d.generationService.getState().isGenerating).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A server on the LAN — tool turns
// ---------------------------------------------------------------------------
describe('remote tool turns', () => {
  it('a second tool turn while one is running sends nothing', async () => {
    d = await launchGeneration();
    server = await connectServer(d);
    server.reply({ content: ['first ', 'answer'], hold: true });

    const first = d.generationService.generateWithTools(d.conversationId, d.ask('one'), { enabledToolIds: [] });
    await until(() => d.useChatStore.getState().streamingMessage === 'first ', 'the first reply');
    await d.generationService.generateRemoteWithTools(d.conversationId, d.ask('two'), { enabledToolIds: ['calculator'] });

    expect(server.requests).toHaveLength(1);
    server.release();
    await first;
    expect(d.answers().map((m: any) => m.content)).toEqual(['first answer']);
  });

  it('streams the reasoning, runs the tool, and stores the answer that follows it', async () => {
    d = await launchGeneration();
    d.useAppStore.getState().updateSettings({ thinkingEnabled: true });
    server = await connectServer(d, { caps: { supportsThinking: true } });
    server.reply(
      { reasoning: ['need ', 'math'], toolCalls: [{ id: 'call-1', name: 'calculator', arguments: { expression: '2+2' } }] },
      { content: ['It is ', '4.'] },
    );

    await d.generationService.generateWithTools(
      d.conversationId, d.ask('what is 2 + 2'), { enabledToolIds: ['calculator'] },
    );

    expect(server.requests).toHaveLength(2);
    const answers = d.answers();
    expect(answers[answers.length - 1].content).toBe('It is 4.');
    expect(answers[answers.length - 1].generationMeta).toEqual(expect.objectContaining({
      gpuBackend: 'Remote', modelName: 'Qwen3 8B', timeToFirstToken: expect.any(Number),
    }));
    expect(d.generationService.getState().isGenerating).toBe(false);
  });
});
