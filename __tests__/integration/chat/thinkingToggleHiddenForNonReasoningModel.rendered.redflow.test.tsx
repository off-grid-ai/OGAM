/**
 * DEVICE 2026-07-14 — the quick-settings popover showed a "Thinking" toggle for Mistral 7B, which has
 * NO native thinking support. Root cause: supportsNativeThinking returned true for ANY model whose
 * Jinja chat template renders (`isJinjaSupported() → true`) — conflating "has a working template" with
 * "emits reasoning." Mistral has a valid tool-use template but no reasoning markers, so the toggle
 * wrongly appeared. Capability must derive from the reasoning delimiters in the model's own
 * chat_template (templateEmitsReasoning), never from Jinja support.
 *
 * REAL ChatScreen + real llmService load + real capability plumbing (engines → useChatScreen → popover);
 * only the llama.rn context is faked, carrying the model's GGUF chat_template on model.metadata exactly
 * as the device exposes it. The user opens the quick-settings popover via the real gesture and looks for
 * the Thinking toggle.
 *
 * RED before the fix: the toggle rendered for the marker-free (Mistral) template. GREEN: it does not.
 * Falsified the other way by the reasoning-capable case below (a <think> template DOES show it).
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

// Mistral 7B's chat template: a plain [INST] tool/chat template with NO reasoning delimiters.
const MISTRAL_TEMPLATE = "{{ bos_token }}{% for message in messages %}{% if message['role'] == 'user' %}[INST] {{ message['content'] }} [/INST]{% else %}{{ message['content'] }}{% endif %}{% endfor %}";
// A reasoning model's template carries a <think> delimiter (DeepSeek/Qwen-style).
const THINKING_TEMPLATE = "{{ bos_token }}<think>\n{{ reasoning }}\n</think>{{ content }}";

describe('Thinking toggle visibility follows the model chat_template, not Jinja support — device 2026-07-14', () => {
  it('a model with NO reasoning markers in its template (Mistral 7B) shows NO Thinking toggle', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', chatTemplate: MISTRAL_TEMPLATE });
    h.render();
    const view = h.view!;

    // Open the quick-settings popover the real way.
    h.rtl.fireEvent.press(await h.rtl.waitFor(() => view.getByTestId('quick-settings-button')));

    // The popover is open (a sibling control renders) but the Thinking toggle is ABSENT.
    // Anti-false-green: assert the popover actually opened by finding a control that is always present.
    await h.rtl.waitFor(() => { expect(view.getByTestId('quick-tools')).toBeTruthy(); });
    expect(view.queryByTestId('quick-thinking-toggle')).toBeNull(); // RED before the fix: present
  });

  it('a model whose template carries a <think> delimiter DOES show the Thinking toggle (falsification)', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', chatTemplate: THINKING_TEMPLATE });
    h.render();
    const view = h.view!;

    h.rtl.fireEvent.press(await h.rtl.waitFor(() => view.getByTestId('quick-settings-button')));
    await h.rtl.waitFor(() => { expect(view.getByTestId('quick-thinking-toggle')).toBeTruthy(); });
  });
});
