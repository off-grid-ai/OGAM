/**
 * T117 (checklist Area 3) — AUTO-EVICTION on OS memory pressure: when the OS fires a memory warning, the
 * residency manager reclaims idle SIDECARS (whisper/tts/embedding) to free RAM, but keeps the active HEAVY
 * (text/image). modelResidencyManager registers a real AppState('memoryWarning') listener → handleMemoryWarning.
 *
 * Boundary: the OS memory-warning event (fired via the capturing AppState in the native boundary — the exact
 * event the app's real listener handles). Validated through the model selector's real "In Memory" section:
 * after the warning, the whisper sidecar row is gone while the text model row stays.
 *
 * Falsify: don't fire the warning → whisper stays listed → red (proves the reclaim is driven by the event,
 * not a constant).
 */
import { setupChatScreen } from '../../harness/chatHarness';

// Real navigation: the app's own NavigationContainer and routes (chatHarness navigation: 'real').
jest.unmock('@react-navigation/native');

describe('T117 (rendered) — OS memory warning reclaims idle sidecars (In Memory UI)', () => {
  it('drops the idle whisper sidecar on a memory warning while the text model stays', async () => {
    const h = await setupChatScreen({ navigation: 'real', engine: 'litert', platform: 'android', whisper: true });
    h.render();
     
    const React = require('react');
    const { ModelsManagerSheet } = require('../../../src/components/models/ModelsManagerSheet');
     
    const openSelector = () => h.rtl.render(h.inNavigator(React.createElement(ModelsManagerSheet, {
      visible: true, onClose: () => {}, labels: { text: '—', image: '—', voice: '—', speech: '—' },
      loadingState: { isLoading: false }, isEjecting: false, hasActiveModel: false,
      onOpenRow: () => {}, onEject: () => {},
    })));

    // Text model + whisper sidecar both resident (real load + real STT select).
    await h.setupWhisperModel();
    const before = openSelector();
    await h.rtl.waitFor(() => { expect(before.queryByTestId('models-row-speech-ram')).not.toBeNull(); }, { timeout: 4000 });
    expect(before.queryByTestId('models-row-text-ram')).not.toBeNull();
    before.unmount();

    // The OS fires a memory warning (the real AppState event the app listens to).
    await h.rtl.act(async () => { h.boundary.emitMemoryWarning(); await new Promise(r => setTimeout(r, 50)); });

    // In Memory UI: the idle whisper sidecar was reclaimed; the active text model stays.
    const after = openSelector();
    await h.rtl.waitFor(() => { expect(after.queryByTestId('models-row-speech-ram')).toBeNull(); }, { timeout: 4000 });
    expect(after.queryByTestId('models-row-text-ram')).not.toBeNull();
  });
});
