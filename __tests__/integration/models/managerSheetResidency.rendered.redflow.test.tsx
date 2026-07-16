/**
 * RED-FLOW (UI integration, HEAVY entry point) — the MODELS manager sheet is the residency surface
 * (agreed design 2026-07-14): each modality row shows a RAM chip when its model is RESIDENT plus a
 * per-row eject control; "Eject All" stays; row tap still opens that type's picker. And "In Memory"
 * moves OUT of the Select Model picker (the manager sheet replaces it).
 *
 * Real HomeScreen + real picker gestures + real activeModelService/modelResidencyManager; fakes only
 * at the native llama/fs/RAM boundary. The ResidentsProbe (test-only) is the sanctioned observable
 * for the raw resident set; every product assertion rides the real sheet/picker surfaces.
 *
 * RED on HEAD: the sheet has no RAM chip and no per-row eject; the picker still renders In Memory.
 * Falsifiers: before any load the text row shows NO chip and NO eject (and the other rows never do);
 * after eject the chip is gone while the row still opens the picker.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { createDownloadedModel } from '../../utils/factories';

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useRoute: () => ({ params: {} }),
  useFocusEffect: () => {}, useIsFocused: () => true,
}));

/** Invoke the onPress bound at/above a testID host (AnimatedPressable's onPress lives on the composite). */
function pressByWalkingUp(node: unknown): void {
  type N = { props?: Record<string, unknown>; parent?: N | null } | null;
  let n = node as N;
  for (let d = 0; n && d < 12; d++) {
    const op = n.props?.onPress;
    if (typeof op === 'function') { (op as () => void)(); return; }
    n = n.parent ?? null;
  }
  throw new Error('no onPress found walking up from the node');
}

async function setupHome() {
  const boundary = installNativeBoundary({ llama: true, fs: true, ram: { platform: 'android', totalBytes: 12 * GB, availBytes: 8 * GB } });
  const g = globalThis as unknown as { window?: Record<string, unknown> };
  if (!g.window) g.window = { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };

  const React = require('react');
  const rtl = requireRTL();
  const { hardwareService } = require('../../../src/services/hardware');
  const { useAppStore } = require('../../../src/stores');
  const AsyncStorage = require('@react-native-async-storage/async-storage').default ?? require('@react-native-async-storage/async-storage');
  const { activeModelService } = require('../../../src/services/activeModelService');
  const { HomeScreen } = require('../../../src/screens/HomeScreen');
  const { ResidentsProbe } = require('../../harness/ResidentsProbe');

  // BOUNDARY: a downloaded model = the persisted record + the file on disk (a real download's artifact).
  const docs = boundary.fs!.DocumentDirectoryPath;
  const modelPath = `${docs}/models/ggml-small.gguf`;
  boundary.fs!.seedFile(modelPath, 500 * 1024 * 1024);
  const model = createDownloadedModel({ id: 'm', name: 'Test Model', engine: 'llama', filePath: modelPath, fileName: 'ggml-small.gguf' });
  await AsyncStorage.setItem('@local_llm/downloaded_models', JSON.stringify([model]));
  await hardwareService.refreshMemoryInfo();
  require('../../../src/components/onboarding/spotlightState').setPendingSpotlight(null);
  useAppStore.setState({ checklistDismissed: true, shownSpotlights: { input: true, voiceHint: true, imageSettings: true } });

  const nav = { navigate: () => {}, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} };
  const view = rtl.render(React.createElement(
    React.Fragment, null,
    React.createElement(ResidentsProbe, {}),
    React.createElement(HomeScreen, { navigation: nav }),
  ));
  await rtl.waitFor(() => { expect(useAppStore.getState().downloadedModels.length).toBeGreaterThan(0); }, { timeout: 10000 });

  // GESTURE: select the text model the way a user does — open the picker, tap the row.
  rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('browse-models-button')));
  const rows = await rtl.waitFor(() => { const r = view.queryAllByTestId('model-item'); expect(r.length).toBeGreaterThan(0); return r; }, { timeout: 10000 });
  rtl.fireEvent.press(rows[0]);
  await rtl.waitFor(() => { expect(useAppStore.getState().activeModelId).toBe('m'); }, { timeout: 10000 });

  return { boundary, React, rtl, useAppStore, activeModelService, view };
}

describe('manager sheet residency — RAM chip + per-row eject (agreed design 2026-07-14)', () => {
  // Heavy rendered residency flow (real modelResidencyManager + mounted Home). The per-step
  // waitFor budgets and the overall timeout were raised after this flaked on a loaded CI runner
  // (the residency state settled just past the old 4s window; passed everywhere else). Behaviour
  // is unchanged — this only gives the async settling more headroom under load.
  it('shows the RAM chip + eject on a resident row, ejects it, and the row still opens the picker', async () => {
    const h = await setupHome();
    const { rtl, view } = h;

    // PRE (falsifier baseline): sheet open BEFORE any load → NO chip, NO eject on any row.
    rtl.fireEvent.press(await rtl.waitFor(() => view.getByTestId('models-summary')));
    await rtl.waitFor(() => { expect(view.queryByTestId('models-row-text')).not.toBeNull(); });
    for (const t of ['text', 'image', 'voice', 'speech']) {
      expect(view.queryByTestId(`models-row-${t}-ram`)).toBeNull();
      expect(view.queryByTestId(`models-row-${t}-eject`)).toBeNull();
    }

    // The REAL load path (residency manager registers the text resident) — the lazy load a send triggers.
    await rtl.act(async () => { await h.activeModelService.loadTextModel('m'); });
    await rtl.waitFor(() => { expect(view.getByTestId('probe-residents').props.children).toContain('text'); }, { timeout: 10000 });

    // RED on HEAD: the resident text row shows a RAM chip + its own eject control; other rows do not.
    await rtl.waitFor(() => { expect(view.queryByTestId('models-row-text-ram')).not.toBeNull(); }, { timeout: 10000 });
    expect(view.queryByTestId('models-row-text-eject')).not.toBeNull();
    for (const t of ['image', 'voice', 'speech']) {
      expect(view.queryByTestId(`models-row-${t}-ram`)).toBeNull();
      expect(view.queryByTestId(`models-row-${t}-eject`)).toBeNull();
    }

    // GESTURE: eject the text row. The chip + eject clear; the resident is really gone (probe).
    await rtl.act(async () => { pressByWalkingUp(view.getByTestId('models-row-text-eject')); });
    await rtl.waitFor(() => { expect(view.queryByTestId('models-row-text-ram')).toBeNull(); }, { timeout: 10000 });
    await rtl.waitFor(() => { expect(view.getByTestId('probe-residents').props.children).toBe('(none)'); }, { timeout: 10000 });

    // The row itself still opens the text picker (eject must not swallow the row tap).
    await rtl.act(async () => { pressByWalkingUp(view.getByTestId('models-row-text')); });
    await rtl.waitFor(() => { expect(view.queryAllByTestId('model-item').length).toBeGreaterThan(0); }, { timeout: 10000 });
  }, 60000);

  it('the Select Model picker no longer renders the In Memory section (moved to the manager sheet)', async () => {
    const h = await setupHome();
    const { rtl, view, React } = h;

    await rtl.act(async () => { await h.activeModelService.loadTextModel('m'); });
    // Guard against the trivially-green null: a resident REALLY exists (the section would render on HEAD).
    await rtl.waitFor(() => { expect(view.getByTestId('probe-residents').props.children).toContain('text'); }, { timeout: 10000 });

    // The surface that carried "In Memory": the chat's ModelSelectorModal (mounted the way the
    // sibling memory suite does — with a resident live, the section rendered here on HEAD).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    const picker = rtl.render(React.createElement(ModelSelectorModal, {
      visible: true, onClose: () => {}, onSelectModel: () => {}, onUnloadModel: () => {}, isLoading: false,
      currentModelPath: null,
    }));
    await rtl.waitFor(() => { expect(picker.queryByText('Select Model')).not.toBeNull(); }, { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 400)); // one poll tick of the section, so absence is real

    // RED on HEAD: the picker still shows "In Memory". The manager sheet is the residency surface now.
    expect(picker.queryByTestId('in-memory-section')).toBeNull();
  }, 60000);
});
