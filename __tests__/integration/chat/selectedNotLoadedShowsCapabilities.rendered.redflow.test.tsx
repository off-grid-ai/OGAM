/**
 * DEVICE 2026-07-13 — a just-SELECTED Gemma 4 (GGUF) must show its Tools + Thinking settings
 * BEFORE it is loaded. Models load lazily (on first send), but the quick-settings popover derived
 * tools/thinking from the LOADED native context — so for a selected-but-not-loaded Gemma 4 the
 * Thinking toggle was hidden and Tools read "N/A", then both appeared the moment the first send
 * loaded the model. User: "even if the right model is selected like gemma 4, but it is not loaded,
 * it doesn't show me the appropriate settings… when the model was loaded it immediately showed it."
 *
 * SPEC: capability affordances derive from the SELECTED model (static name/mmproj prediction,
 * `predictGgufCapabilities`) until the engine loads; the loaded template-derived capability then
 * stays authoritative. Unknown model names keep today's conservative behavior (no promise).
 *
 * Journey (real ChatScreen, real stores/services, fake only the native boundary): install a
 * Gemma-4-named GGUF selected-but-NOT-loaded (deferInitialLoad — the exact lazy-flow state) →
 * open the quick-settings popover via its real button → the Thinking toggle IS present and Tools
 * shows its count badge (not "N/A"). Falsifier: an unknown-named GGUF in the same unloaded state
 * still hides Thinking + reads "N/A" — proving the affordance is model-derived, not always-on.
 */
import { setupChatScreen } from '../../harness/chatHarness';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => require('../../harness/chatHarness').routeHolder,
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

describe('selected-but-not-loaded GGUF shows its real capability settings (rendered)', () => {
  it('Gemma 4 selected (NOT loaded): the quick-settings popover shows the Thinking toggle and a Tools count', async () => {
    const h = await setupChatScreen({
      engine: 'llama', platform: 'android', deferInitialLoad: true,
      modelName: 'Gemma 4 E2B', modelFileName: 'gemma-4-E2B-it-Q4_K_M.gguf',
    });
    h.render();
    const { rtl } = h; const view = h.view!;

    // Real gesture: open the quick-settings popover from the composer.
    const btn = await rtl.waitFor(() => view.getByTestId('quick-settings-button'));
    await rtl.act(async () => { rtl.fireEvent.press(btn); });

    // Terminal artifacts (pre-load): the Thinking toggle renders (RED: hidden until first send
    // loads the model) and Tools shows its enabled count badge, not the unsupported "N/A".
    await rtl.waitFor(() => { expect(view.queryByTestId('quick-thinking-toggle')).not.toBeNull(); }, { timeout: 4000 });
    expect(view.queryByText('N/A')).toBeNull();
  });

  it('falsifier — an unknown-named GGUF in the same unloaded state promises nothing (no Thinking toggle, Tools N/A)', async () => {
    const h = await setupChatScreen({ engine: 'llama', platform: 'android', deferInitialLoad: true });
    h.render();
    const { rtl } = h; const view = h.view!;

    const btn = await rtl.waitFor(() => view.getByTestId('quick-settings-button'));
    await rtl.act(async () => { rtl.fireEvent.press(btn); });

    // The popover is open (Tools row renders)…
    await rtl.waitFor(() => { expect(view.queryByTestId('quick-tools')).not.toBeNull(); }, { timeout: 4000 });
    // …but an unrecognized model gets no predicted promise: Thinking hidden, Tools reads N/A.
    expect(view.queryByTestId('quick-thinking-toggle')).toBeNull();
    expect(view.queryByText('N/A')).not.toBeNull();
  });
});
