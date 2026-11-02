/**
 * LiteRT compaction keeps what it drops as a summary. A LiteRT session that outgrows its context is rebuilt
 * from the recent turns; the turns it drops are summarized first, on an empty session, because replaying them
 * is what overflowed the context in the first place.
 *
 * Real: liteRTService and liteRTCompaction, the stores. Faked (device, harness/generationDevice): the LiteRT
 * native module, the filesystem, RAM.
 */
import { launchGeneration, type GenerationDevice } from '../../harness/generationDevice';

let d: GenerationDevice;
type Turn = { role: 'user' | 'assistant'; content: string };

beforeEach(async () => {
  const mod = require('@react-native-async-storage/async-storage');
  await (mod.default ?? mod).clear(); // each test is a fresh install
  d = await launchGeneration({ engine: 'litert' });
});

/** Six long turns: about 4,500 tokens by the service's estimate, past compaction at 65% of 4,096. */
const longHistory: Turn[] = Array.from({ length: 6 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content: `turn ${i} ${'word '.repeat(600)}`,
}));
const historyOf = (resetArgs: unknown[]): Turn[] => JSON.parse(String(resetArgs[5] || '[]'));

describe('LiteRT compaction', () => {
  it('summarizes the dropped turns on an empty session, then rebuilds the chat with that summary', async () => {
    const native = d.boundary.litert;
    const resetsBefore = native.calls.resetConversation.length;
    const sendsBefore = native.calls.sendMessage.length;
    native.scriptTurn({ content: 'The user asked for stories about Paris and Lyon.' });

    await d.liteRTService.prepareConversation('conv-long', 'System', { history: longHistory });

    const resets = native.calls.resetConversation.slice(resetsBefore);
    const sends = native.calls.sendMessage.slice(sendsBefore);
    // The summary session holds no history: the dropped turns go in as a transcript instead.
    expect(historyOf(resets[0])).toEqual([]);
    expect(sends).toHaveLength(1);
    expect(String(sends[0][0])).toMatch(/^Briefly summarize/);
    expect(String(sends[0][0])).toContain('user: turn 0');
    // The chat is rebuilt from the summary and the recent turns.
    const rebuilt = historyOf(resets.at(-1)!);
    expect(rebuilt[0].content).toContain('The user asked for stories about Paris and Lyon.');
    expect(rebuilt.at(-1)).toEqual(longHistory.at(-1));
    expect(String(sends[0][0])).not.toContain(longHistory.at(-1)!.content);
  });
});
