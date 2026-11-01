/**
 * generationService — the reply state machine, driven end to end on a faked device.
 *
 * Real: generationService and its helpers, llmService, activeModelService (loads through the residency
 * lock), the tool loop and the calculator tool, the provider registry and the OpenAI-compatible provider,
 * the stores, logger and sharePrompt. Faked (device / network, harness/generationDevice): llama.rn, the
 * filesystem, RAM, and the OpenAI-compatible server on the LAN at its XMLHttpRequest.
 *
 * Assertions read what the user ends up with: the streamed and stored answer, the service's state, the
 * error raised, what reached the native engine or the server.
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

function storage() {
  const mod = require('@react-native-async-storage/async-storage');
  return mod.default ?? mod;
}

let d: GenerationDevice;
let server: ServerHandle | null = null;

beforeEach(async () => {
  await storage().clear(); // each test is a fresh install
});

afterEach(async () => {
  server?.restore();
  server = null;
});

const queued = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id, conversationId: 'c1', text, messageText: text, ...extra,
});

// ============================================================================
// State and subscription
// ============================================================================
describe('state and subscription', () => {
  beforeEach(async () => {
    d = await launchGeneration();
  });

  it('starts idle and hands out a copy of its state', () => {
    const state = d.generationService.getState();
    expect(state).toEqual(expect.objectContaining({
      isGenerating: false, isThinking: false, conversationId: null, streamingContent: '', startTime: null,
    }));

    state.isGenerating = true;
    state.conversationId = 'modified';
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.generationService.getState().conversationId).toBeNull();
  });

  it('isGeneratingFor is true only for the chat being answered, only while it is answered', async () => {
    expect(d.generationService.isGeneratingFor(d.conversationId)).toBe(false);
    d.boundary.llama!.scriptCompletion({ text: 'Hello there', pauseAfter: 'Hello' });

    const reply = d.generationService.generateResponse(d.conversationId, d.ask('Hi'));
    await until(() => d.useChatStore.getState().streamingMessage === 'Hello', 'the first words');

    expect(d.generationService.isGeneratingFor(d.conversationId)).toBe(true);
    expect(d.generationService.isGeneratingFor('different-conversation')).toBe(false);
    d.boundary.llama!.releaseStream();
    await reply;
    expect(d.generationService.isGeneratingFor(d.conversationId)).toBe(false);
  });

  it('a subscriber hears the current state at once and every change after, until it unsubscribes', () => {
    const first: any[] = [];
    const second: any[] = [];
    const unsubscribe = d.generationService.subscribe((s: any) => first.push(s));
    d.generationService.subscribe((s: any) => second.push(s));
    expect(first).toEqual([expect.objectContaining({ isGenerating: false, isThinking: false })]);

    d.generationService.enqueueMessage(queued('q1', 'Hello'));
    expect(first).toHaveLength(2);
    expect(second[second.length - 1].queuedMessages).toHaveLength(1);

    unsubscribe();
    d.generationService.enqueueMessage(queued('q2', 'Again'));
    expect(first).toHaveLength(2);
    expect(second[second.length - 1].queuedMessages).toHaveLength(2);
  });
});

// ============================================================================
// A local (llama.rn) reply
// ============================================================================
describe('generateResponse on the local llama model', () => {
  it('fails with "No model loaded" when the selected model is not in memory', async () => {
    d = await launchGeneration({ load: false });

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('Hello')))
      .rejects.toThrow('No model loaded');
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
    expect(d.boundary.llama!.calls.completion).toHaveLength(0);
  });

  it('thinks until the first token, streams into the chat, and stores the whole answer with its details', async () => {
    d = await launchGeneration();
    const states: any[] = [];
    d.generationService.subscribe((s: any) => states.push({ ...s }));
    let firstTokens = 0;
    d.boundary.llama!.scriptCompletion({ text: 'Hello world', holdBeforeStream: true });

    const reply = d.generationService.generateResponse(
      d.conversationId, d.ask('Hi'), () => { firstTokens += 1; },
    );
    await until(() => d.boundary.llama!.calls.completion.length === 1, 'the native completion');

    // Prefill: generating, thinking, the chat is streaming but nothing is shown yet.
    expect(d.generationService.getState()).toEqual(expect.objectContaining({
      isGenerating: true, isThinking: true, conversationId: d.conversationId,
    }));
    expect(d.useChatStore.getState().streamingForConversationId).toBe(d.conversationId);
    expect(d.useChatStore.getState().streamingMessage).toBe('');

    d.boundary.llama!.releaseStream();
    await reply;

    expect(firstTokens).toBe(1);
    expect(states.some(s => s.isGenerating && !s.isThinking)).toBe(true);
    expect(d.generationService.getState()).toEqual(expect.objectContaining({
      isGenerating: false, isThinking: false, conversationId: null, streamingContent: '', startTime: null,
    }));
    expect(d.useChatStore.getState().streamingMessage).toBe('');
    expect(d.useChatStore.getState().isStreaming).toBe(false);
    const [answer] = d.answers();
    expect(answer.content).toBe('Hello world');
    expect(answer.generationTimeMs).toEqual(expect.any(Number));
    expect(answer.generationMeta).toEqual(expect.objectContaining({
      modelName: 'Test Model',
      gpu: expect.any(Boolean),
      gpuBackend: expect.any(String),
      tokensPerSecond: expect.any(Number),
    }));
  });

  it('ignores a second request while one is running: the device sees one completion', async () => {
    d = await launchGeneration();
    d.boundary.llama!.scriptCompletion({ text: 'First answer', pauseAfter: 'First' });

    const first = d.generationService.generateResponse(d.conversationId, d.ask('First'));
    await until(() => d.useChatStore.getState().streamingMessage === 'First', 'the first words');
    await d.generationService.generateResponse(d.conversationId, d.ask('Second'));

    expect(d.boundary.llama!.calls.completion).toHaveLength(1);
    d.boundary.llama!.releaseStream();
    await first;
    expect(d.answers().map((m: any) => m.content)).toEqual(['First answer']);
  });

  it('keeps the reasoning a thinking model streams beside the answer', async () => {
    d = await launchGeneration();
    d.useAppStore.getState().updateSettings({ thinkingEnabled: true });
    d.boundary.llama!.scriptCompletion({ text: 'answer', reasoning: 'thinking step' });

    await d.generationService.generateResponse(d.conversationId, d.ask('Hi'));

    const [answer] = d.answers();
    expect(answer.content).toBe('answer');
    expect(answer.reasoningContent).toBe('thinking step');
  });

  it('raises a native failure at the start and leaves nothing streaming', async () => {
    d = await launchGeneration();
    d.boundary.llama!.scriptCompletion({ throwMessage: 'Failed' });

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('Hi'))).rejects.toThrow('Failed');

    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
    // The failed turn is kept as an empty failed answer (so the chat can offer a retry), never as text.
    expect(d.answers().map((m: any) => [m.content, m.turnStatus])).toEqual([['', 'failed']]);
  });

  it('keeps the words already shown when the native decode fails mid-reply', async () => {
    d = await launchGeneration();
    d.boundary.llama!.scriptCompletion({ text: 'partial', throwAfter: 'sudden failure' });

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('Hi')))
      .rejects.toThrow('sudden failure');

    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.answers().map((m: any) => [m.content, m.turnStatus])).toEqual([['partial', 'failed']]);
    // No batched-token flush is left to fire into a later reply.
    await tick(80);
    expect(d.useChatStore.getState().streamingMessage).toBe('');
  });
});

// ============================================================================
// The share prompt after a reply
// ============================================================================
describe('the share prompt after a reply', () => {
  const heard = () => {
    const variants: string[] = [];
    require('../../../src/utils/sharePrompt').subscribeSharePrompt((v: string) => variants.push(v));
    return variants;
  };

  it('asks once, for text, from the second reply of a session', async () => {
    d = await launchGeneration();
    const variants = heard();
    d.boundary.llama!.scriptCompletions([{ text: 'One' }, { text: 'Two' }]);

    await d.generationService.generateResponse(d.conversationId, d.ask('Hi'));
    await d.generationService.generateResponse(d.conversationId, d.ask('Again'));
    expect(variants).toEqual([]);
    await until(() => variants.length > 0, 'the share prompt', 2500);

    expect(variants).toEqual(['text']);
  });

  it('never asks a person who already engaged with it', async () => {
    d = await launchGeneration();
    d.useAppStore.getState().setHasEngagedSharePrompt(true);
    const variants = heard();
    d.boundary.llama!.scriptCompletions([{ text: 'One' }, { text: 'Two' }]);

    await d.generationService.generateResponse(d.conversationId, d.ask('Hi'));
    await d.generationService.generateResponse(d.conversationId, d.ask('Again'));
    await tick(1700);

    expect(variants).toEqual([]);
  });
});

// ============================================================================
// Stop
// ============================================================================
describe('stopGeneration', () => {
  it('when nothing runs, returns nothing, adds nothing, and tells the engine to stop anyway', async () => {
    d = await launchGeneration();
    const stops = d.nativeContext()!.stopCompletion;

    await expect(d.generationService.stopGeneration()).resolves.toBe('');

    expect(stops).toHaveBeenCalled();
    expect(d.answers()).toEqual([]);
  });

  it('survives a native stop that fails', async () => {
    d = await launchGeneration();
    d.nativeContext()!.stopCompletion.mockRejectedValueOnce(new Error('Stop failed'));

    await expect(d.generationService.stopGeneration()).resolves.toBe('');
  });

  it('keeps the partial answer shown, returns it, and resets', async () => {
    d = await launchGeneration();
    d.boundary.llama!.scriptCompletion({ text: 'Partial content and more', pauseAfter: 'Partial content' });

    const reply = d.generationService.generateResponse(d.conversationId, d.ask('Hi'));
    await until(() => d.generationService.getState().streamingContent === 'Partial content', 'the partial');
    const partial = await d.generationService.stopGeneration();
    await reply;

    expect(partial).toBe('Partial content');
    expect(d.answers().map((m: any) => [m.content, m.turnStatus])).toEqual([['Partial content', 'cancelled']]);
    expect(d.generationService.getState()).toEqual(expect.objectContaining({
      isGenerating: false, isThinking: false, conversationId: null, streamingContent: '', startTime: null,
    }));
  });

  it('IGNORES a token the device emits AFTER Stop (abort guard is load-bearing)', async () => {
    // The mid-stream-cancel race: a native completion can deliver one more token after the user hit Stop.
    d = await launchGeneration();
    d.boundary.llama!.scriptCompletion({ text: 'Partial answer', pauseAfter: 'Partial' });

    const reply = d.generationService.generateResponse(d.conversationId, d.ask('Hi'));
    await until(() => d.generationService.getState().streamingContent === 'Partial', 'the partial');
    const lateToken = d.nativeOnToken()!;
    expect(await d.generationService.stopGeneration()).toBe('Partial');

    lateToken({ token: ' LEAKED', content: 'Partial LEAKED' });
    await reply;
    await tick(80);

    expect(d.generationService.getState().streamingContent).toBe('');
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingMessage).toBe('');
    expect(d.answers().map((m: any) => m.content)).toEqual(['Partial']);
  });

  it('a Stop during prefill (nothing shown yet) keeps only an empty stopped turn and resets', async () => {
    d = await launchGeneration();
    d.boundary.llama!.scriptCompletion({ text: 'never shown', holdBeforeStream: true });

    const reply = d.generationService.generateResponse(d.conversationId, d.ask('Hi'));
    await until(() => d.boundary.llama!.calls.completion.length === 1, 'the native completion');
    expect(await d.generationService.stopGeneration()).toBe('');
    await reply;

    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
    expect(d.answers().map((m: any) => [m.content, m.turnStatus])).toEqual([['', 'cancelled']]);
  });
});

// ============================================================================
// The queue
// ============================================================================
describe('the message queue', () => {
  beforeEach(async () => {
    d = await launchGeneration();
  });

  it('adds, removes and clears queued messages', () => {
    d.generationService.enqueueMessage(queued('q1', 'First'));
    d.generationService.enqueueMessage(queued('q2', 'Second'));
    expect(d.generationService.getState().queuedMessages.map((m: any) => m.id)).toEqual(['q1', 'q2']);

    d.generationService.removeFromQueue('q1');
    expect(d.generationService.getState().queuedMessages.map((m: any) => m.id)).toEqual(['q2']);

    d.generationService.clearQueue();
    expect(d.generationService.getState().queuedMessages).toEqual([]);
  });

  it('sends what is queued in one chat as one turn, text joined and attachments kept', () => {
    const sent: any[] = [];
    d.generationService.setQueueProcessor(async (item: any) => { sent.push(item); });
    d.generationService.enqueueMessage(queued('q1', 'First', { attachments: [{ id: 'att-1', type: 'image', uri: '/img1.jpg' }] }));
    d.generationService.enqueueMessage(queued('q2', 'Second'));
    d.generationService.enqueueMessage(queued('q3', 'Third'));

    d.generationService.drainQueue();

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toBe('First\n\nSecond\n\nThird');
    expect(sent[0].attachments).toEqual([{ id: 'att-1', type: 'image', uri: '/img1.jpg' }]);
    expect(d.generationService.getState().queuedMessages).toEqual([]);
  });

  it('sends a single queued message as it is', () => {
    const sent: any[] = [];
    d.generationService.setQueueProcessor(async (item: any) => { sent.push(item); });
    const only = queued('q1', 'Only one');
    d.generationService.enqueueMessage(only);

    d.generationService.drainQueue();

    expect(sent).toEqual([only]);
  });

  it('keeps the queue when no chat is there to send it', () => {
    d.generationService.setQueueProcessor(async () => {});
    d.generationService.setQueueProcessor(null);
    d.generationService.enqueueMessage(queued('q1', 'Hello'));

    d.generationService.drainQueue();

    expect(d.generationService.getState().queuedMessages).toHaveLength(1);
  });

  it('waits while a reply runs, and sends the queue once that reply is stored', async () => {
    const sent: any[] = [];
    d.generationService.setQueueProcessor(async (item: any) => { sent.push(item); });
    d.boundary.llama!.scriptCompletion({ text: 'done now', pauseAfter: 'done' });
    const reply = d.generationService.generateResponse(d.conversationId, d.ask('Hi'));
    await until(() => d.useChatStore.getState().streamingMessage === 'done', 'the first words');
    d.generationService.enqueueMessage(queued('q1', 'queued', { conversationId: d.conversationId }));

    d.generationService.drainQueue();
    expect(sent).toEqual([]);
    expect(d.generationService.getState().queuedMessages).toHaveLength(1);

    d.boundary.llama!.releaseStream();
    await reply;
    await until(() => sent.length === 1, 'the queued turn');
    expect(sent[0]).toEqual(expect.objectContaining({ id: 'q1', text: 'queued' }));
  });

  // Seen on an iPhone: after send now, the stopped reply settled twice and the second drain sent the
  // other queued message while the send-now turn was still starting, so the two ran at once.
  it('sends the next queued turn only after the one being sent settles, however often a reply settles', async () => {
    let settle: () => void = () => {};
    const sent: any[] = [];
    d.generationService.setQueueProcessor((item: any) => {
      sent.push(item);
      return new Promise<void>(resolve => { settle = resolve; });
    });
    d.generationService.enqueueMessage(queued('q1', 'title'));
    d.generationService.enqueueMessage(queued('q2', 'moral'));
    d.generationService.sendQueuedNow('q2');

    d.generationService.drainQueue();
    d.generationService.drainQueue();

    expect(sent.map(m => m.text)).toEqual(['moral']);
    expect(d.generationService.getState().queuedMessages.map((m: any) => m.text)).toEqual(['title']);

    settle();
    await tick();
    expect(sent.map(m => m.text)).toEqual(['moral', 'title']);
  });
});

// ============================================================================
// A reply from a server on the LAN
// ============================================================================
describe('generateResponse on a remote (OpenAI-compatible) model', () => {
  it('answers from the selected server model even while a local model is in memory', async () => {
    d = await launchGeneration();
    expect(d.llmService.isModelLoaded()).toBe(true);
    server = await connectServer(d);
    server.reply({ content: ['Remote ', 'response'] });

    await d.generationService.generateResponse(d.conversationId, d.ask('Hi'));

    expect(d.boundary.llama!.calls.completion).toHaveLength(0);
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0].model).toBe('qwen3-8b');
    const [answer] = d.answers();
    expect(answer.content).toBe('Remote response');
    expect(answer.generationMeta).toEqual(expect.objectContaining({
      gpu: false, gpuBackend: 'Remote', modelName: 'Qwen3 8B', timeToFirstToken: expect.any(Number),
    }));
    expect(d.generationService.getState().isGenerating).toBe(false);
  });

  it('keeps the reasoning a thinking server model streams', async () => {
    d = await launchGeneration();
    d.useAppStore.getState().updateSettings({ thinkingEnabled: true });
    server = await connectServer(d, { caps: { supportsThinking: true } });
    server.reply({ reasoning: ['Thinking', '...'], content: ['Response'] });

    await d.generationService.generateResponse(d.conversationId, d.ask('Hi'));

    const [answer] = d.answers();
    expect(answer.content).toBe('Response');
    expect(answer.reasoningContent).toBe('Thinking...');
  });

  it('a saved server whose provider is not registered yet does not take the turn', async () => {
    d = await launchGeneration({ load: false });
    server = await connectServer(d, { select: false, register: false });

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('Hi')))
      .rejects.toThrow('No model loaded');
    expect(server.requests).toHaveLength(0);
  });

  it('fails with "Remote provider not ready" when no model is chosen on the server', async () => {
    d = await launchGeneration({ localModel: false });
    // No model was found on it either, so there is nothing to fall back to.
    server = await connectServer(d, { select: false, discovered: false });

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('Hi')))
      .rejects.toThrow('Remote provider not ready');
    expect(server.requests).toHaveLength(0);
    expect(d.generationService.getState().isGenerating).toBe(false);
  });

  it('raises a server error and marks the server unhealthy', async () => {
    d = await launchGeneration({ localModel: false });
    server = await connectServer(d);
    server.reply({ status: 500 });

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('Hi'))).rejects.toThrow('upstream failed');

    expect(d.useRemoteServerStore.getState().serverHealth[server.serverId].isHealthy).toBe(false);
    expect(d.generationService.getState().isGenerating).toBe(false);
  });

  it('keeps the words shown when the server reports an error mid-stream', async () => {
    d = await launchGeneration({ localModel: false });
    server = await connectServer(d);
    server.reply({ content: ['partial'], streamError: 'provider error' });

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('Hi'))).rejects.toThrow('provider error');

    expect(d.answers().map((m: any) => m.content)).toEqual(['partial']);
    await tick(80);
    expect(d.useChatStore.getState().streamingMessage).toBe('');
  });

  it('keeps the words shown when the connection drops mid-stream', async () => {
    d = await launchGeneration({ localModel: false });
    server = await connectServer(d);
    server.reply({ content: ['partial content'], dropConnection: true });

    await expect(d.generationService.generateResponse(d.conversationId, d.ask('Hi'))).rejects.toThrow('Network error');

    expect(d.answers().map((m: any) => m.content)).toEqual(['partial content']);
    expect(d.useRemoteServerStore.getState().serverHealth[server.serverId].isHealthy).toBe(false);
  });

  it('Stop closes the connection, keeps and returns the partial, and resets', async () => {
    d = await launchGeneration();
    server = await connectServer(d);
    server.reply({ content: ['partial ', 'response'], hold: true });

    const reply = d.generationService.generateResponse(d.conversationId, d.ask('Hi'));
    await until(() => d.generationService.getState().streamingContent === 'partial ', 'the partial');
    const partial = await d.generationService.stopGeneration();
    await reply;

    expect(partial).toBe('partial ');
    expect(server.aborted).toBe(1);
    expect(d.answers().map((m: any) => m.content)).toEqual(['partial']);
    expect(d.generationService.getState().isGenerating).toBe(false);
  });

  it('when the server fails, the turn falls back to the local model and says so', async () => {
    d = await launchGeneration();
    server = await connectServer(d);
    server.reply({ status: 500 });
    d.boundary.llama!.scriptCompletion({ text: 'Local answer' });

    await d.generationService.generateResponse(d.conversationId, d.ask('Hi'));

    expect(server.requests).toHaveLength(1);
    expect(d.thread().filter((m: any) => m.role === 'tool').map((m: any) => m.content))
      .toEqual(['Qwen3 8B could not answer. Trying Test Model.']);
    expect(d.answers().map((m: any) => m.content)).toEqual(['Local answer']);
    expect(d.useRemoteServerStore.getState().activeServerId).toBeNull();
  });

  it('generateRemoteResponse fails when the active server has no provider', async () => {
    d = await launchGeneration();
    server = await connectServer(d, { select: false, register: false });

    await expect(d.generationService.generateRemoteResponse(d.conversationId, d.ask('Hi')))
      .rejects.toThrow('No remote provider available');
    expect(d.generationService.getState().isGenerating).toBe(false);
  });
});

// ============================================================================
// Replies that use tools
// ============================================================================
describe('generateWithTools on the local llama model', () => {
  it('runs the tool the model calls and stores the answer that follows', async () => {
    d = await launchGeneration();
    d.boundary.llama!.scriptCompletions([
      // llama.rn's tool_calls shape (OpenAI-style, arguments as a JSON string).
      { text: 'Let me work that out.', toolCalls: [{ type: 'function', function: { name: 'calculator', arguments: '{"expression":"6*7"}' } }] as any },
      { text: 'It is 42.' },
    ]);

    const outcome = await d.generationService.generateWithTools(
      d.conversationId, d.ask('what is 6 times 7'), { enabledToolIds: ['calculator'] },
    );

    expect(outcome).toEqual(expect.objectContaining({ interrupted: false }));
    const tool = d.thread().find((m: any) => m.role === 'tool');
    expect(tool.content).toContain('42');
    expect(d.answers()[d.answers().length - 1].content).toBe('It is 42.');
    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingMessage).toBe('');
  });

  it('raises a native failure in the tool loop and resets', async () => {
    d = await launchGeneration();
    // A failed decode (device B13 wire), which the loop does not retry.
    d.boundary.llama!.scriptCompletion({ throwMessage: 'llama_decode: failed to decode, ret = -1: Failed to evaluate chunks' });

    await expect(d.generationService.generateWithTools(
      d.conversationId, d.ask('use tools'), { enabledToolIds: ['calculator'] },
    )).rejects.toThrow('Failed to evaluate chunks');

    expect(d.generationService.getState().isGenerating).toBe(false);
    expect(d.useChatStore.getState().streamingForConversationId).toBeNull();
  });

  it('a Stop during the tool turn keeps the partial once and stores nothing more', async () => {
    d = await launchGeneration();
    d.boundary.llama!.scriptCompletion({ text: 'Working on it now', pauseAfter: 'Working' });

    const reply = d.generationService.generateWithTools(
      d.conversationId, d.ask('use tool'), { enabledToolIds: ['calculator'] },
    );
    await until(() => d.useChatStore.getState().streamingMessage.includes('Working'), 'the partial');
    await d.generationService.stopGeneration();
    await reply;
    await tick(80);

    expect(d.answers().map((m: any) => m.content)).toEqual(['Working']);
    expect(d.generationService.getState().isGenerating).toBe(false);
  });

  it('a native failure that lands after Stop is not raised to the user', async () => {
    d = await launchGeneration();
    // The person stops mid-reply and the decode that was running fails as it ends.
    d.boundary.llama!.scriptCompletion({
      text: 'Working on it', pauseAfter: 'Working', throwAfter: 'llama_decode: failed to decode, ret = -1: Failed to evaluate chunks',
    });

    const reply = d.generationService.generateWithTools(
      d.conversationId, d.ask('tool'), { enabledToolIds: ['calculator'] },
    );
    await until(() => d.useChatStore.getState().streamingMessage.includes('Working'), 'the partial');
    await d.generationService.stopGeneration();

    await expect(reply).resolves.toBeUndefined();
    expect(d.generationService.getState().isGenerating).toBe(false);
  });
});

describe('generateWithTools on a remote model', () => {
  it('runs the tool the server model calls, sends the result back, and stores the answer', async () => {
    d = await launchGeneration();
    server = await connectServer(d);
    server.reply(
      { toolCalls: [{ id: 'call-1', name: 'calculator', arguments: { expression: '6*7' } }] },
      { content: ['remote ', 'result 42'] },
    );

    await d.generationService.generateWithTools(
      d.conversationId, d.ask('what is 6 times 7'), { enabledToolIds: ['calculator'] },
    );

    expect(d.boundary.llama!.calls.completion).toHaveLength(0);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[0].tools.map((t: any) => t.function.name)).toContain('calculator');
    const toolResult = server.requests[1].messages.find((m: any) => m.role === 'tool');
    expect(JSON.stringify(toolResult.content)).toContain('6*7 = 42');
    expect(d.answers()[d.answers().length - 1].content).toBe('remote result 42');
    expect(d.generationService.getState().isGenerating).toBe(false);
  });

  it('a Stop during the remote tool turn stores only the partial', async () => {
    d = await launchGeneration();
    server = await connectServer(d);
    server.reply({ content: ['partial ', 'more'], hold: true });

    const reply = d.generationService.generateWithTools(
      d.conversationId, d.ask('tool'), { enabledToolIds: [] },
    );
    await until(() => d.useChatStore.getState().streamingMessage === 'partial ', 'the partial');
    await d.generationService.stopGeneration();
    await reply;
    await tick(80);

    expect(d.answers().map((m: any) => m.content)).toEqual(['partial']);
    expect(d.generationService.getState().isGenerating).toBe(false);
  });

  it('generateRemoteWithTools fails when the active server has no provider', async () => {
    d = await launchGeneration();
    server = await connectServer(d, { select: false, register: false });

    await expect(d.generationService.generateRemoteWithTools(
      d.conversationId, d.ask('Hi'), { enabledToolIds: [] },
    )).rejects.toThrow('No remote provider available');
    expect(d.generationService.getState().isGenerating).toBe(false);
  });
});
