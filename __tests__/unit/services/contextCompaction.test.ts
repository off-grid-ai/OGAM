/**
 * Context compaction — when a chat no longer fits the model's context, keep the recent turns and replace
 * the older ones with a summary the model writes.
 *
 * Real: contextCompactionService, llmService (token counts, the KV cache, the summary completion),
 * activeModelService (the model loads through the residency lock), the chat store. Faked (device,
 * harness/generationDevice): llama.rn — its tokenizer, KV cache and completion — the filesystem, RAM.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';
import { createMessage } from '../../utils/factories';
import type { Message } from '../../../src/types';

let d: GenerationDevice;
let compaction: any;

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
  d = await launchGeneration();
  compaction = require('../../../src/services/contextCompaction').contextCompactionService;
});

/** The native tokenizer: 10 tokens for the system prompt, `perMessage` for anything else. */
function tokenizer(perMessage: number) {
  d.nativeContext()!.tokenize.mockImplementation(async (text: string) => ({
    tokens: new Array(text === 'System' ? 10 : perMessage).fill(1),
  }));
}

const compactWith = (messages: Message[], extra: { previousSummary?: string } = {}) =>
  compaction.compact({ conversationId: d.conversationId, systemPrompt: 'System', allMessages: messages, ...extra });
const conversation = () =>
  d.useChatStore.getState().conversations.find((c: any) => c.id === d.conversationId);

describe('isContextFullError', () => {
  it.each([
    'Context is full',
    'Not enough context space',
    'CONTEXT IS FULL',
    'Failed: context is full, cannot continue',
    'context window exceeded',
    'context length exceeded',
  ])('"%s" is a context-full error', msg => {
    expect(compaction.isContextFullError(new Error(msg))).toBe(true);
  });

  it('is false for an unrelated error, and reads a plain string too', () => {
    expect(compaction.isContextFullError(new Error('No model loaded'))).toBe(false);
    expect(compaction.isContextFullError('context is full')).toBe(true);
  });
});

describe('compact', () => {
  it('clears the native KV cache, and keeps a chat that fits as it is', async () => {
    tokenizer(5);
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'msg 1' }),
      createMessage({ role: 'assistant', content: 'reply 1' }),
      createMessage({ role: 'user', content: 'latest question' }),
    ];

    const result = await compactWith(messages);

    expect(d.boundary.llama!.calls.clearCache).toContain(true);
    expect(result.map((m: Message) => m.content)).toEqual(['System', 'msg 1', 'reply 1', 'latest question']);
    expect(conversation().compactionSummary).toBeUndefined();
  });

  it('summarizes the older turns with the model, keeps the latest, and stores the summary on the chat', async () => {
    tokenizer(2000); // only the latest turn fits beside the summary
    d.boundary.llama!.scriptCompletion({ text: 'Summary of conversation' });
    const old = createMessage({ role: 'assistant', content: 'old reply' });
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'old msg' }),
      old,
      createMessage({ role: 'user', content: 'latest' }),
    ];

    const result = await compactWith(messages);

    expect(result.map((m: Message) => m.content)).toEqual([
      'System',
      '[Previous conversation summary]\nSummary of conversation',
      'latest',
    ]);
    expect(conversation()).toEqual(expect.objectContaining({
      compactionSummary: 'Summary of conversation',
      compactionCutoffMessageId: old.id,
    }));
    expect(d.thread().at(-1)).toEqual(expect.objectContaining({ isSystemInfo: true, content: expect.stringContaining('Compacted') }));
    // The model was asked to summarize the old turns, not the latest.
    const sent = JSON.stringify((d.boundary.llama!.calls.completion.at(-1)![0] as any).messages);
    expect(sent).toContain('old msg');
    expect(sent).not.toContain('latest');
  });

  it('keeps an earlier summary when nothing new needs summarizing', async () => {
    tokenizer(5);

    const result = await compactWith([createMessage({ role: 'user', content: 'Hello' })], { previousSummary: 'Earlier talk' });

    expect(result.map((m: Message) => m.content)).toEqual(['System', '[Previous conversation summary]\nEarlier talk', 'Hello']);
  });

  it('trims without a summary when the model fails to write one, and stores nothing', async () => {
    tokenizer(2000);
    d.boundary.llama!.scriptCompletion({ throwMessage: 'generation failed' });
    const messages = [
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'old msg' }),
      createMessage({ role: 'assistant', content: 'old reply' }),
      createMessage({ role: 'user', content: 'latest' }),
    ];

    const result = await compactWith(messages);

    expect(result.map((m: Message) => m.content)).toEqual(['System', 'latest']);
    expect(conversation().compactionSummary).toBeUndefined();
  });

  it('counts by characters when the native tokenizer fails', async () => {
    d.nativeContext()!.tokenize.mockRejectedValue(new Error('tokenizer unavailable'));

    const result = await compactWith([
      createMessage({ role: 'system', content: 'System' }),
      createMessage({ role: 'user', content: 'Hello' }),
    ]);

    expect(result.map((m: Message) => m.content)).toEqual(['System', 'Hello']);
  });
});

describe('clearSummary', () => {
  it('removes the stored summary from the chat', async () => {
    d.useChatStore.getState().updateCompactionState(d.conversationId, 'a summary', 'm1');

    compaction.clearSummary(d.conversationId);

    expect(conversation().compactionSummary).toBeUndefined();
    expect(conversation().compactionCutoffMessageId).toBeUndefined();
  });
});

describe('the compacting state', () => {
  it('is on while compacting and off after', async () => {
    tokenizer(5);
    const states: boolean[] = [];
    const unsub = compaction.subscribeCompacting((v: boolean) => states.push(v));

    await compactWith([createMessage({ role: 'user', content: 'Hello' })]);
    unsub();

    expect(states[0]).toBe(false);
    expect(states).toContain(true);
    expect(states.at(-1)).toBe(false);
  });

  it('goes off again when clearing the native KV cache fails', async () => {
    d.nativeContext()!.clearCache.mockRejectedValueOnce(new Error('cache error'));
    const states: boolean[] = [];
    const unsub = compaction.subscribeCompacting((v: boolean) => states.push(v));

    await compactWith([]).catch(() => undefined);
    unsub();

    expect(states).toContain(true);
    expect(states.at(-1)).toBe(false);
  });
});
