/**
 * RENDERED — a LiteRT turn the engine refuses for a full context is compacted and retried, not failed.
 *
 * DEVICE GROUND TRUTH (Pixel 9, Gemma 4 E2B LiteRT at 1024 tokens, 2026-11-03): LiteRT-LM refused a turn
 * with "Status Code: 8. Message: Not enough space left in the context window for the input: 832 tokens in
 * the context + 511 input tokens >= 1024 max number of tokens." and, after a long reply, with "Status
 * Code: 9. Message: Chosen prefill work group size exceeds available state entries (107)." Neither was
 * recognised as a full context, so the chat showed the error instead of compacting and retrying.
 *
 * The same refusal on llama.cpp ("Context is full") takes the same path.
 *
 * Real: the chat screen, the turn path, contextCompaction, liteRTService, the stores. Faked: the LiteRT
 * native module (its errors are the device's, verbatim), the filesystem, RAM.
 */
import { setupChatScreen, renderedThread } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

const DEVICE_ERRORS = [
  'Status Code: 8. Message: Not enough space left in the context window for the input: 832 tokens in the context + 511 input tokens >= 1024 max number of tokens.',
  'Status Code: 9. Message: Chosen prefill work group size exceeds available state entries (107).',
];

describe('LiteRT full-context refusal', () => {
  it.each(DEVICE_ERRORS)('compacts and answers when native refuses with "%s"', async deviceError => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert' });
    h.render();
    const view = h.view!;
    const native = h.boundary.litert;

    await h.send('Write a detailed story about Paris.', { content: 'Once upon a time in Paris.' });
    await h.rtl.waitFor(() => expect(view.queryByText(/Once upon a time in Paris\./)).not.toBeNull());
    expect(view.queryByText(/Lyon has the best food\./)).toBeNull();

    native.scriptError(deviceError);
    await h.send('Which city has the best food?', { content: 'Lyon has the best food.' });

    await h.rtl.waitFor(() => expect(view.queryByText(/Lyon has the best food\./)).not.toBeNull(), { timeout: 20000 });
    expect(view.queryByText(/Status Code/)).toBeNull();
    expect(renderedThread(view).filter(line => line.startsWith('assistant:'))).toEqual([
      expect.stringContaining('Once upon a time in Paris.'),
      expect.stringContaining('Lyon has the best food.'),
    ]);
  }, 60000);
});

describe('llama.cpp full-context refusal', () => {
  it('compacts and answers with no empty reply left from the refused attempt', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    h.render();
    const view = h.view!;
    const native = h.boundary.llama!;

    await h.send('Write a detailed story about Paris.', { text: 'Once upon a time in Paris.' });
    await h.rtl.waitFor(() => expect(view.queryByText(/Once upon a time in Paris\./)).not.toBeNull());
    expect(view.queryByText(/Lyon has the best food\./)).toBeNull();

    // The refused attempt, then the retried answer.
    native.scriptCompletions([{ throwMessage: 'Context is full' }, { text: 'Lyon has the best food.' }]);
    await h.tapSend('Which city has the best food?');

    await h.rtl.waitFor(() => expect(view.queryByText(/Lyon has the best food\./)).not.toBeNull(), { timeout: 20000 });
    expect(view.queryByText(/Context is full/)).toBeNull();
    expect(renderedThread(view).filter(line => line.startsWith('assistant:'))).toEqual([
      expect.stringContaining('Once upon a time in Paris.'),
      expect.stringContaining('Lyon has the best food.'),
    ]);
  }, 60000);
});
