/**
 * RENDERED — a LiteRT chat compacts for the context the engine actually loaded.
 *
 * DEVICE GROUND TRUTH (Pixel 9, Gemma 4 E2B LiteRT, Max Tokens 4096, 2026-11-02): native clamped the
 * context to 1024 tokens to fit free RAM. Compaction budgeted for llama.cpp's 2048-token setting, so it
 * did not run, and the engine refused the turn as over its context before the retry trimmed it.
 *
 * Faked at the native boundary as the engine behaves: a session is refused, with LiteRT-LM's own error,
 * when it holds more tokens than the context it loaded. That refusal has no rendered surface of its own
 * (the retry hides it), so it is read off the boundary; the reply and the absence of an error are read
 * off the screen.
 *
 * Real: the chat screen, the turn path, contextCompaction, engines, liteRTService, the stores. Faked: the
 * LiteRT native module, the filesystem, RAM.
 */
import { setupChatScreen, renderedThread } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

const LOADED_CONTEXT_TOKENS = 1024;
const CHARS_PER_TOKEN = 4;

type Harness = Awaited<ReturnType<typeof setupChatScreen>>;

/**
 * BOUNDARY: the LiteRT native session holds its system prompt, tools and history from the last reset,
 * plus every message sent since; a send that would take it past the loaded context is refused.
 */
function refuseSendsOverLoadedContext(h: Harness): { refusals: string[] } {
  const native = h.boundary.litert;
  const refusals: string[] = [];
  let sessionChars = 0;
  const reset = native.module.resetConversation.getMockImplementation()!;
  native.module.resetConversation.mockImplementation((...args: unknown[]) => {
    sessionChars = [args[0], args[4], args[5]].reduce((n: number, part) => n + String(part ?? '').length, 0);
    return reset(...args);
  });
  const send = native.module.sendMessage.getMockImplementation()!;
  native.module.sendMessage.mockImplementation((...args: unknown[]) => {
    const text = String(args[0]);
    const tokens = Math.ceil((sessionChars + text.length) / CHARS_PER_TOKEN);
    if (tokens > LOADED_CONTEXT_TOKENS) {
      refusals.push(text.slice(0, 40));
      setTimeout(() => native.events.emit('litert_error', `Input token ids are too long. Exceeding the maximum number of tokens allowed: ${tokens} >= ${LOADED_CONTEXT_TOKENS}`), 0);
      return Promise.resolve();
    }
    sessionChars += text.length;
    return send(...args);
  });
  return { refusals };
}

describe('LiteRT compaction on a clamped context', () => {
  it('a chat past the loaded 1024-token context compacts before the send, and the reply arrives', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', deferInitialLoad: true });
    h.setTextSettingViaUI('liteRTMaxTokens', 4096);
    h.render();
    const view = h.view!;
    h.boundary.litert.module.loadModel.mockResolvedValueOnce({ backend: 'gpu', maxNumTokens: LOADED_CONTEXT_TOKENS });
    const { refusals } = refuseSendsOverLoadedContext(h);

    await h.send(`Write a short story about Paris. ${'Paris '.repeat(220)}`, { content: 'Once upon a time in Paris.' });
    await h.rtl.waitFor(() => expect(view.queryByText(/Once upon a time in Paris\./)).not.toBeNull(), { timeout: 20000 });
    expect(refusals).toEqual([]);

    await h.send(`Now one about Lyon. ${'Lyon '.repeat(260)}`, { content: 'Once upon a time in Lyon.' });

    await h.rtl.waitFor(() => expect(view.queryByText(/Once upon a time in Lyon\./)).not.toBeNull(), { timeout: 20000 });
    expect(renderedThread(view).filter(line => line.startsWith('assistant:'))).toEqual([
      expect.stringContaining('Once upon a time in Paris.'),
      expect.stringContaining('Once upon a time in Lyon.'),
    ]);
    expect(view.queryByText(/Exceeding the maximum number of tokens|Failed to generate|context/i)).toBeNull();
    expect(refusals).toEqual([]);
    // Kept whole, the Paris turn and the Lyon turn come to about 1,260 tokens: compaction dropped it.
    const lastSession = String(h.boundary.litert.calls.resetConversation.at(-1)![5] ?? '');
    expect(lastSession).not.toContain('Write a short story about Paris.');
  }, 60000);
});
