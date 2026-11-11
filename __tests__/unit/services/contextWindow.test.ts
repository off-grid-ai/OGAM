import { contextOutputReserve, fitMessagesToContext } from '../../../src/services/contextWindow';

type TestMessage = { role: string; content: string; id: string };
const msg = (id: string, role: string, content: string): TestMessage => ({ id, role, content });
const fit = (messages: TestMessage[], contextTokens = 256, outputTokens = 64) =>
  fitMessagesToContext({
    messages, contextTokens, outputTokens,
    format: items => items.map(m => m.content).join('|'),
    countTokens: async text => text.length,
  });

describe('shared flexible context window', () => {
  it('reserves an output budget without using unbounded native context', () => {
    expect(contextOutputReserve(4096, 8192)).toBeLessThan(4096 / 2);
    expect(contextOutputReserve(4096, 512)).toBe(512);
  });

  it('keeps all messages unchanged when they fit', async () => {
    const history = [msg('s', 'system', 'Be helpful'), msg('u', 'user', 'Hello')];
    const result = await fit(history);
    expect(result.messages).toBe(history);
    expect(result.droppedMessages).toBe(0);
  });

  it('keeps system instructions and the most recent turns first', async () => {
    const history = [
      msg('system', 'system', 'Rules'),
      ...Array.from({ length: 10 }, (_, i) => msg(String(i), i % 2 ? 'assistant' : 'user', 'z'.repeat(45))),
      msg('recent', 'user', 'The current request'),
    ];
    const result = await fit(history);
    expect(result.droppedMessages).toBeGreaterThan(0);
    expect(result.messages[0].id).toBe('system');
    expect(result.messages[result.messages.length - 1].id).toBe('recent');
    expect(result.promptTokens).toBeLessThanOrEqual(result.budgetTokens);
    expect(history).toHaveLength(12); // The saved history is never mutated.
  });

  it('trims an oversized newest message, retaining its ending', async () => {
    const last = 'START' + 'x'.repeat(400) + 'FINAL QUESTION';
    const history = [msg('s', 'system', 'Rule'), msg('1', 'user', last)];
    const result = await fit(history);
    expect(result.latestTruncated).toBe(true);
    expect(result.messages[1].content).toContain('FINAL QUESTION');
    expect(result.messages[1].content).not.toContain('START');
    expect(result.promptTokens).toBeLessThanOrEqual(result.budgetTokens);
    expect(history[1].content).toBe(last);
  });

  it('rejects impossible system prompts instead of silently discarding instructions', async () => {
    await expect(fit([msg('s', 'system', 's'.repeat(500)), msg('u', 'user', 'Hi')]))
      .rejects.toThrow(/system instructions/i);
  });

  it('uses a conservative fallback when native tokenization is unavailable', async () => {
    const result = await fitMessagesToContext({
      messages: [msg('s', 'system', 'Rule'), msg('u', 'user', 'Hello world')],
      contextTokens: 256, outputTokens: 64,
      format: items => items.map(x => x.content).join('|'),
      countTokens: async () => { throw new Error('Native tokenizer missing'); },
    });
    expect(result.messages).toHaveLength(2);
    expect(result.promptTokens).toBeGreaterThan(0);
  });

  it('starts the prompt at the same message across consecutive turns once it has to drop some', async () => {
    const chat = (n: number) => [
      msg('system', 'system', 'Rules'),
      ...Array.from({ length: n }, (_, i) => msg(`m${i}`, i % 2 ? 'assistant' : 'user', 'z'.repeat(40))),
    ];
    // Each turn adds a user and a reply (2 messages). The first kept message must not move on every turn.
    const firstKept = async (n: number) => (await fit(chat(n), 600, 64)).messages.find(m => m.role !== 'system')!.id;
    const starts = [await firstKept(40), await firstKept(42), await firstKept(44)];
    expect(new Set(starts).size).toBe(1);
  });
});
