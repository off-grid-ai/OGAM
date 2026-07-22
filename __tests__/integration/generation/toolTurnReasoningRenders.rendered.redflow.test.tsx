/**
 * P0 #180 / DEVICE 2026-07-14 (live log 21:11) — with a tool enabled and thinking ON, gemma-4 reasoned and llama
 * returned it cleanly separated:
 *   content:           "Hello! How can I help you today?"
 *   reasoning_content: "The user said \"Hi\"… friendly manner"
 *   text:              "<|channel>thought\n…<channel|>Hello!"   (raw combined)
 * But the tool-generation path only consumed the raw stream tokens / cr.text, so the reasoning + its
 * <|channel> markers leaked into the ANSWER bubble and no thinking block rendered.
 *
 * SPEC (the user's rule): whatever reasoning the runtime hands us, DISPLAY it — in the thinking block,
 * not smeared into the reply. The fix makes the tool path read reasoning_content + content exactly like
 * the non-tool path (no hand-parsing hack).
 *
 * Real mounted ChatScreen + real generation/tool loop; fake ONLY the llama.rn boundary, emitting the
 * device-shaped split (reasoning on reasoning_content, clean answer on content, raw markers only in text).
 *
 * RED on HEAD (pre-fix): the answer bubble shows the reasoning / a raw "<|channel>" marker and there's no
 * thinking block. GREEN: the reasoning is in the thinking block and the answer is the clean text only.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

const REASONING = 'The user said Hi, a simple greeting, so I should respond in a friendly manner.';
const ANSWER = 'Hello! How can I help you today?';

describe('tool turn reasoning renders (rendered) — device log 21:11', () => {
  it('shows gemma reasoning in the thinking block, with NO <|channel> leak into the answer', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.enableToolViaUI('calculator');                              // real toggle → the turn runs the TOOL loop
    h.render();
    const { rtl } = h;
    const view = h.view!;

    // Enable Thinking through the real composer control. The capability comes from the
    // GGUF chat template exposed by the llama boundary, so this is the same path a user takes.
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('quick-settings-button')));
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('quick-thinking-toggle')));

    // Device-shaped: the model reasons (reasoning_content) then answers (content); raw markers only in text.
    await h.send('Hi', { text: ANSWER, reasoning: REASONING });

    // The answer renders as its OWN clean text node — exactly ANSWER, with no reasoning merged in.
    // RED on HEAD: the tool path appended the raw reasoning tokens to the answer, so no node equals
    // ANSWER exactly (it's "…friendly manner.Hello! How can I help you today?") → this fails.
    await rtl.waitFor(() => { expect(view.getByText(ANSWER)).toBeTruthy(); }, { timeout: 4000 });

    // The raw reasoning delimiter NEVER appears in the visible transcript.
    expect(view.queryByText(/<\|channel/)).toBeNull();

    // The reasoning is shown as a thinking block (expand it and read the content).
    const block = await rtl.waitFor(() => view.getByTestId('thinking-block'), { timeout: 4000 });
    const toggle = view.getByTestId('thinking-block-toggle');
    await rtl.act(async () => {
      type N = { props?: Record<string, unknown>; parent?: N | null } | null;
      let n = toggle as unknown as N;
      for (let d = 0; n && d < 12; d++) { const op = n.props?.onPress; if (typeof op === 'function') { (op as () => void)(); break; } n = n.parent ?? null; }
    });
    await rtl.waitFor(() => {
      const content = view.queryAllByTestId('thinking-block-content');
      expect(content.some(c => rtl.within(c).queryByText(/friendly manner/) != null)).toBe(true);
    }, { timeout: 4000 });
    expect(block).toBeTruthy();
  }, 30000);
});
