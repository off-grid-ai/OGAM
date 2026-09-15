/**
 * UI integration (heavy entry point) — the "Enhanced prompt" bubble WHILE it streams.
 *
 * Device evidence (Android, 2026-08-09, user screenshots): with prompt enhancement ON, the bubble showed
 * the raw wrapper for the whole stream —
 *
 *     <think>__LABEL:Enhanced prompt__
 *     <think>
 *     </think>
 *     Drawing a dog running involves several elements:
 *     1. **Subject**: ...
 *
 * — unstyled, unparsed, asterisks and all, and only turned into the labelled markdown card once the
 * stream ended. From the user's view the card must read the same from the FIRST token to the last: an
 * "Enhanced prompt" header over markdown, never the machinery that produces it.
 *
 * Real ChatScreen + real dispatch + real imageGenerationService + real message parse/render; only the
 * llama and diffusion natives are faked. The enhancement stream is PARKED mid-flight (pauseAfter) so the
 * partial genuinely renders and can be asserted — the leak lived exactly in that window.
 *
 * The scripted enhancement carries the model's OWN <think></think>, as the device's did: that nested pair
 * inside the label container is what made the wrapper ambiguous, so a test without it would not ride the
 * bug.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {},
  useIsFocused: () => true,
}));

/** The device's shape: the model reasons first, then writes the prompt in markdown. */
const PAUSE = 'PAUSE_MID_STREAM';
const ENHANCEMENT =
  '<think>\nThe user wants a dog running.\n</think>\n\n' +
  `**Subject**: an energetic dog running.${PAUSE}\n\n` +
  '**Style**: cinematic lighting, 8k.';

/** Arrive-via-UI: turn prompt enhancement ON by tapping the real toggle on the real settings section. */
async function enableEnhanceViaUI(h: Awaited<ReturnType<typeof setupChatScreen>>) {

  const { ImageGenerationSection } = require('../../../src/components/GenerationSettingsModal/ImageGenerationSection');
  const s = h.rtl.render(h.React.createElement(ImageGenerationSection, {}));
  h.rtl.fireEvent.press(s.getByTestId('modal-image-advanced-toggle'));
  h.rtl.fireEvent.press(await h.rtl.waitFor(() => s.getByTestId('image-enhance-on')));
  s.unmount();
}

describe('the Enhanced prompt card renders as a card from the first token', () => {
  it('shows the labelled markdown card mid-stream, never the raw <think>/__LABEL: wrapper', async () => {
    const h = await setupChatScreen({ engine: 'llama' });
    h.render();
    await h.placeImageModel({ backend: 'coreml' });
    await h.cycleImageMode(); // auto -> ON(force); also activates the downloaded image model
    await enableEnhanceViaUI(h);

    // BEFORE: no card on screen at all, so "the card appeared" below is a real transition.
    expect(h.view!.queryByTestId('thinking-block')).toBeNull();

    // Park the enhancement mid-stream so the PARTIAL genuinely renders (the window the leak lived in).
    h.boundary.llama!.scriptCompletion({ text: ENHANCEMENT, pauseAfter: PAUSE });
    await h.tapSend('draw a dog running');

    const view = h.view!;
    await h.rtl.waitFor(() => { expect(view.queryByTestId('thinking-block')).not.toBeNull(); });

    // It reads as the "Enhanced prompt" card, not as a status line.
    expect(view.getByTestId('thinking-block-title').props.children).toBe('Enhanced prompt');

    // Nothing of the machinery is on screen: not the container tags, not the label sentinel, not the
    // model's own reasoning tags.
    expect(view.queryByText(/__LABEL:/)).toBeNull();
    expect(view.queryByText(/<\/?think>/)).toBeNull();

    // Live work is open by default. The body is MARKDOWN, so the bold markers are rendered, not printed.
    await h.rtl.waitFor(() => { expect(view.queryByTestId('thinking-block-content')).not.toBeNull(); });
    expect(view.queryByText(/\*\*/)).toBeNull();
    expect(view.queryByText(/an energetic dog running/)).not.toBeNull();

    // Release the stream: the turn finishes and the image the enhancement was for is drawn.
    h.boundary.llama!.releaseStream();
    await h.rtl.waitFor(() => { expect(view.queryByTestId('generated-image')).not.toBeNull(); }, { timeout: 8000 });

    // The card survives the finish clean — the same header, still no wrapper.
    expect(view.getAllByTestId('assistant-work-toggle')).toHaveLength(1);
    await h.rtl.waitFor(() => {
      const toggle = view.getByTestId('assistant-work-toggle');
      expect(toggle.props.accessibilityLabel).toBe('Work done');
      expect(toggle.props.accessibilityState.expanded).toBe(false);
    });
    h.rtl.fireEvent.press(view.getByLabelText('Work done'));
    await h.rtl.waitFor(() => {
      expect(view.getByTestId('thinking-block-title').props.children).toBe('Enhanced prompt');
    });
    expect(view.queryByText(/__LABEL:/)).toBeNull();
  });
});
