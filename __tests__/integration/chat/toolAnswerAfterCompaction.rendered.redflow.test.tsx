/**
 * Device 2026-11-06 (Qwen 3.5 2B, iPhone, DeepWiki MCP on): the model called a tool, the next round hit a
 * full context, the conversation compacted, and the final answer then streamed for minutes with NOTHING on
 * screen but the user's message and Stop. Stop made the whole answer appear at once.
 *
 * Real stack: ChatScreen, the real tool loop and the real compaction service. The llama boundary calls the
 * calculator, reports a full context on the next round, writes the summary, then streams the answer and
 * holds mid-stream. The answer streamed so far must be on screen while it streams.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.unmock('@react-navigation/native');

describe('a tool turn that compacts before its answer', () => {
  it('shows the answer while it streams after the mid-turn compaction', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'llama' });
    h.enableToolViaUI('calculator');
    h.render();

    // llama.cpp counts tokens in proportion to the text. The long question no longer fits beside the
    // tool round, so compaction has an older message to summarise (as the long DeepWiki round did).
    const question = `[test] What is 37 times 43? Show the working. ${'Context. '.repeat(4000)}`;
    h.boundary.llama!.scriptCompletions([
      {
        // Qwen writes its call in the text, as on the device.
        text: 'Let me calculate 37 times 43.<tool_call>{"name":"calculator","arguments":{"expression":"37*43"}}</tool_call>',
        holdBeforeStream: true,
      },
      { completionMeta: { context_full: true } },
      { text: 'The user asked for 37 times 43.' },
      {
        text: '37 times 43 is 1591. Working: 37 x 40 = 1480, 37 x 3 = 111.',
        pauseAfter: 'is 1591.',
      },
    ]);
    await h.tapSend(question);
    await h.rtl.waitFor(() => {
      expect(h.boundary.llama!.calls.completion).toHaveLength(1);
    });
    for (const result of (h.boundary.llama!.module.initLlama as jest.Mock).mock.results) {
      const context = await result.value;
      (context.tokenize as jest.Mock).mockImplementation(async (text: string) => ({
        tokens: new Array(Math.ceil((text?.length ?? 0) / 4)).fill(1),
      }));
    }
    h.boundary.llama!.releaseStream();

    await h.rtl.waitFor(
      () => {
        expect(h.boundary.llama!.calls.completion.length).toBeGreaterThanOrEqual(4);
      },
      { timeout: 8000 },
    );
    // Still streaming: the stream is held after the first sentence.
    expect(h.view!.queryByTestId('stop-button')).not.toBeNull();
    await h.rtl.waitFor(
      () => {
        expect(h.view!.queryByText(/37 times 43 is 1591\./)).not.toBeNull();
      },
      { timeout: 4000 },
    );

    h.boundary.llama!.releaseStream();
    await h.rtl.waitFor(
      () => {
        expect(h.view!.queryByText(/37 x 3 = 111\./)).not.toBeNull();
      },
      { timeout: 4000 },
    );
  });
});
