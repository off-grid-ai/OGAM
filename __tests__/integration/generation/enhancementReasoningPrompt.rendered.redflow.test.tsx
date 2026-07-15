/**
 * T072 / DEV-B30 (RED) — the enhanced prompt that reaches the image generator must be the clean rewrite,
 * NOT the model's reasoning chain.
 *
 * Device (part37): with thinking ON globally + enhancement ON, the enhancement request went out with
 * enable_thinking=true, so the model produced a reasoning-style answer ("Thinking Process:\n1. Analyze the
 * Request…") — and THAT became the image prompt (slow "million characters", garbage image). User's fix
 * spec: enhancement is a utility completion that must NOT think. T071 asserts the request PARAM
 * (enable_thinking !== true); this asserts the user-observable OUTCOME on the UI — the enhanced prompt the
 * user SEES (rendered as the "Enhanced prompt" block in the chat) is the clean rewrite, not the reasoning dump.
 *
 * Emergent, not testing-the-fake: the llama fake emits the reasoning dump ONLY when the request carries
 * enable_thinking===true (device-faithful — a reasoning model reasons when thinking is on), and the clean
 * rewrite otherwise. So the reasoning-as-prompt symptom is produced by the app's OWN enable_thinking
 * decision. RED on HEAD (enhancement sends enable_thinking=true → reasoning dump → it becomes the prompt).
 * Falsify: forcing enable_thinking=false for the enhancement → the fake emits the clean rewrite → green.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

// The exact device shape (part37): the model answers with its reasoning instead of a prompt. No <think>
// tags, so cleanEnhancedPrompt cannot strip it — it flows straight into the image request as the prompt.
const REASONING_DUMP =
  'Thinking Process:\n1. Analyze the Request: the user wants a cat. 2. I should consider style, ' +
  'lighting, and composition before writing anything. 3. Let me reason step by step about what makes a ' +
  'good cat image and enumerate every option I can think of before committing to a final description.';
const CLEAN_PROMPT = 'a photorealistic tabby cat sitting in a sunlit garden, shallow depth of field';

describe('T072 (rendered) — enhancement reasoning must not become the image prompt (DEV-B30)', () => {
  it('shows the clean rewrite as the enhanced prompt, not the model reasoning chain', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android' });
    h.render();

    await h.placeImageModel({ backend: 'coreml' });
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { activeModelService } = require('../../../src/services/activeModelService');
    await activeModelService.loadImageModel('sd');
    await h.cycleImageMode(); // auto → ON(force): "draw a cat" routes to IMAGE
    await h.rtl.waitFor(() => { expect(h.view!.queryByTestId('image-mode-force-badge')).not.toBeNull(); });

    // Thinking ON globally + enhancement ON — the exact device configuration.
    h.useAppStore.getState().updateSettings({ enhanceImagePrompts: true, thinkingEnabled: true });

    // The model reasons when thinking is on (dump), rewrites cleanly when it is off.
    h.boundary.llama!.scriptCompletion({ text: CLEAN_PROMPT, thinkingText: REASONING_DUMP });
    await h.tapSend('draw a cat');
    // The enhancement ran and its result reached the chat as the "Enhanced prompt" block (precondition:
    // a real rendered surface, so a no-op can't fake a pass).
    await h.rtl.waitFor(() => { expect(h.view!.queryByText('Enhanced prompt')).not.toBeNull(); }, { timeout: 6000 });

    // SPEC (UI layer): the enhanced prompt the user sees is the clean rewrite. RED on HEAD: enhancement
    // leaves thinking on → the reasoning dump ("Thinking Process:…") is what renders as the prompt.
    expect(h.view!.queryByText(/Thinking Process/i)).toBeNull();
    // And the clean rewrite is the one shown (its preview text renders).
    expect(h.view!.queryByText(/photorealistic tabby cat/i)).not.toBeNull();
  });
});
