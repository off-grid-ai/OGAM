/**
 * RENDERED — a LiteRT chat that outgrows its context keeps what compaction drops as a summary.
 *
 * DEVICE GROUND TRUTH (Pixel 9, Gemma 4 E2B LiteRT, 2026-11-02): compaction under LiteRT asked llama.cpp
 * for the summary. llama.cpp is not loaded beside a LiteRT model, so the summary failed and the older
 * turns were dropped with nothing in their place; the model could not recall them. The LiteRT engine now
 * writes the summary, and after compaction the model recalled the earlier cities.
 *
 * What the user sees is the "Compacting" state and the reply. What the model is given (the summary at the
 * head of the rebuilt session) has no rendered surface, so it is read off the native boundary, the way
 * audio is read off the speak seam.
 *
 * Real: the chat screen, the turn path, contextCompaction, liteRTService, the stores. Faked: the LiteRT
 * native module, the filesystem, RAM.
 */
import { setupChatScreen, renderedThread } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

const SUMMARY = 'The user asked for a long story about Paris.';
const COMPACTING = 'Compacting your conversation...';

type Turn = { role: string; content: string };
const historyOf = (resetArgs: unknown[]): Turn[] => JSON.parse(String(resetArgs[5] || '[]'));

describe('LiteRT compaction from the chat', () => {
  it('the LiteRT model summarizes the dropped turns, and the next session opens with that summary', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', deferInitialLoad: true });
    h.render();
    const view = h.view!;
    const native = h.boundary.litert;
    // Native fits the context to free RAM; on the phone it loaded well under the 4096 setting.
    native.module.loadModel.mockResolvedValueOnce({ backend: 'gpu', maxNumTokens: 2048 });
    const parisQuestion = `Write a long story about Paris. ${'Paris '.repeat(800)}`;

    await h.send(parisQuestion, { content: 'Once upon a time in Paris.' });
    await h.rtl.waitFor(() => expect(view.queryByText(/Once upon a time in Paris\./)).not.toBeNull());
    expect(view.queryByText(COMPACTING)).toBeNull();
    const resetsBefore = native.calls.resetConversation.length;
    const sendsBefore = native.calls.sendMessage.length;
    expect(native.calls.resetConversation.flatMap(historyOf).some(t => t.content.includes(SUMMARY))).toBe(false);

    // The summary request hangs until released, so the Compacting state is held on screen.
    native.scriptHang();
    native.scriptTurn({ content: 'Lyon has the best food.' });
    await h.tapSend(`Now tell me which city has the best food. ${'Lyon '.repeat(800)}`);
    await h.rtl.waitFor(() => expect(view.queryByText(COMPACTING)).not.toBeNull(), { timeout: 20000 });

    // The summary is asked of an empty session holding the dropped turn as a transcript.
    const summaryReset = native.calls.resetConversation[resetsBefore];
    expect(historyOf(summaryReset)).toEqual([]);
    const summaryRequest = String(native.calls.sendMessage[sendsBefore][0]);
    expect(summaryRequest).toContain('Write a long story about Paris.');

    await h.rtl.act(async () => {
      native.events.emit('litert_token', SUMMARY);
      native.events.emit('litert_complete', '{}');
    });

    await h.rtl.waitFor(() => expect(view.queryByText(/Lyon has the best food\./)).not.toBeNull(), { timeout: 20000 });
    expect(view.queryByText(COMPACTING)).toBeNull();
    expect(renderedThread(view).filter(line => line.startsWith('assistant:'))).toEqual([
      expect.stringContaining('Once upon a time in Paris.'),
      expect.stringContaining('Lyon has the best food.'),
    ]);
    const rebuilt = historyOf(native.calls.resetConversation.at(-1)!);
    expect(rebuilt[0].content).toContain(SUMMARY);
    expect(rebuilt.some(t => t.content === parisQuestion)).toBe(false);
  }, 60000);
});
