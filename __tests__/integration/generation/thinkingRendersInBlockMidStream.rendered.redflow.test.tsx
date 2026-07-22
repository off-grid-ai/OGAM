/**
 * T033 / DEV-B14 — while a local (llama/gguf) model is still streaming its <think> reasoning, that reasoning
 * renders in the THINKING BLOCK from the first token — NOT dumped into the answer bubble until the </think>
 * close (the device bug: "the entire thinking phase renders in the ANSWER bubble until the close delimiter,
 * then retroactively reclassifies" — part6/7, on a gguf model → engine:'llama').
 *
 * The bug is only observable MID-STREAM, so the llama fake streams char-by-char and is PAUSED deep inside the
 * still-open <think> (pauseAfter lands well before </think>). The mid-stream render is asserted, then released.
 *
 * GREEN on HEAD (B14 fixed): mid-<think>, the reasoning is in the thinking block and the answer has NOT leaked
 * it. Falsified against the real lever (parseThinkTags' <think> detection): break it → the reasoning leaks
 * into the answer, the thinking block loses it → red.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: () => {},
    goBack: () => {},
    setOptions: () => {},
    addListener: () => () => {},
  }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

const REASON =
  'Step one: consider six groups of seven. Step two: add them up carefully to reach the total.';

describe('T033 (rendered) — <think> reasoning renders in the thinking block mid-stream, not the answer (DEV-B14)', () => {
  it('shows the reasoning in the thinking block (not the answer) while <think> is still open', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    // Enable Thinking through the real composer control so the journey proves the
    // same settings path a user takes instead of manufacturing store state.
    h.rtl.fireEvent.press(
      await h.rtl.waitFor(() => h.view!.getByTestId('quick-settings-button')),
    );
    h.rtl.fireEvent.press(
      await h.rtl.waitFor(() => h.view!.getByTestId('quick-thinking-toggle')),
    );

    // Stream <think>REASON</think>ANSWER but HOLD deep inside the still-open <think> (before </think>).
    h.boundary.llama!.scriptCompletion({
      text: `<think>${REASON}</think>The answer is 42.`,
      pauseAfter: 'Step one: consider six',
    });
    await h.tapSend('what is 6 times 7');

    // MID-<think>: the reasoning renders INSIDE the thinking block (from token 1)...
    const block = await h.rtl.waitFor(
      () => h.view!.getByTestId('thinking-block-content'),
      { timeout: 4000 },
    );
    expect(
      h.rtl.within(block).queryByText(/Step one: consider six/),
    ).not.toBeNull();
    // ...and it has NOT leaked into the answer: the assistant answer is not produced yet (still thinking).
    expect(h.view!.queryByText(/The answer is 42/)).toBeNull();

    h.boundary.llama!.releaseStream();

    // After </think> + the answer stream: the answer now renders.
    await h.rtl.waitFor(
      () => {
        expect(h.view!.queryByText(/The answer is 42/)).not.toBeNull();
      },
      { timeout: 4000 },
    );
  });
});
