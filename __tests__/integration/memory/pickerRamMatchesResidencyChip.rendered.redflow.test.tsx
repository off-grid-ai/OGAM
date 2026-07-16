/**
 * RED-FLOW (UI integration, HEAVY entry point) — RAM DISPLAY AGREEMENT across surfaces.
 *
 * The SAME loaded text model must report the SAME RAM footprint everywhere it is shown. The residency
 * chip on the Models manager sheet (`models-row-text-ram`) reads the resident's registered `sizeMB`,
 * which activeModelService computes with the backend-aware `textOverheadMultiplier(inferenceBackend)`
 * (2.2× on a GPU/NPU backend). The Select-Model picker's "Currently Loaded" RAM label
 * (`currently-loaded-model-ram`) computed the figure with a FIXED 1.5× (hardwareService.formatModelRam
 * default), so on a non-CPU backend the two surfaces disagree for the identical model (device 2026-07-14).
 *
 * SPEC (user's view): loaded a 2GB model on the GPU backend → the picker RAM label and the sheet RAM chip
 * show the SAME number of GB. On HEAD the picker shows ~3.0 GB (1.5×) while the sheet chip shows 4.4 GB
 * (2.2×) → RED. The fix routes the picker label through the SAME backend-aware multiplier owner.
 *
 * Real HomeScreen + real picker/sheet gestures + real activeModelService/modelResidencyManager; fakes only
 * at the native llama/fs/RAM boundary. Backend is switched to GPU via the REAL BackendSelector control
 * (the same store action the settings screen dispatches), before the load, so the resident registers at 2.2×.
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

/** Flatten a rendered node's text content (children may be nested Text elements, arrays, or a string). */
function renderedText(node: { props?: { children?: unknown } }): string {
  const walk = (c: unknown): string => {
    if (c == null || c === false) return '';
    if (typeof c === 'string' || typeof c === 'number') return String(c);
    if (Array.isArray(c)) return c.map(walk).join('');
    const el = c as { props?: { children?: unknown } };
    return el.props ? walk(el.props.children) : '';
  };
  return walk(node.props?.children);
}

/**
 * The RAM figure (GB) from a rendered RAM surface. The picker label reads "quant • 2.00 GB • ~3.0 GB RAM"
 * — the RAM figure is the one before "RAM", NOT the leading disk-size GB. The sheet chip is just "4.4 GB".
 * Prefer the "GB RAM" match; fall back to the sole GB token (the chip).
 */
function ramGb(node: { props?: { children?: unknown } }): string {
  const text = renderedText(node);
  const withRam = /([\d.]+)\s*GB\s*RAM/.exec(text);
  if (withRam) return withRam[1];
  const bare = /([\d.]+)\s*GB/.exec(text);
  if (!bare) throw new Error(`no "N GB" token in: ${JSON.stringify(text)}`);
  return bare[1];
}

describe('RAM display agreement — picker label matches the residency chip for the same model', () => {
  it('shows the SAME GB figure on the manager-sheet chip and the picker "Currently Loaded" label (GPU backend)', async () => {
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
    const { BackendSelector } = require('../../../src/components/settings/textGenAdvancedSections');
    const { ModelSelectorModal } = require('../../../src/components/ModelSelectorModal');
    const { llmService } = require('../../../src/services/llm');

    // BOUNDARY: a downloaded 2GB model = the persisted record + the file on disk. 2GB makes the two
    // multipliers visibly disagree (1.5× → 3.0 GB, 2.2× → 4.4 GB) yet fit the 8GB-avail budget.
    const docs = boundary.fs!.DocumentDirectoryPath;
    const modelPath = `${docs}/models/ggml-small.gguf`;
    boundary.fs!.seedFile(modelPath, 500 * 1024 * 1024);
    const model = createDownloadedModel({ id: 'm', name: 'Test Model', engine: 'llama', filePath: modelPath, fileName: 'ggml-small.gguf', fileSize: 2 * GB });
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

    // GESTURE: switch the inference backend to GPU (OpenCL) via the REAL BackendSelector control — the same
    // store action the settings screen dispatches — BEFORE the load, so the resident registers at 2.2×.
    const settings = rtl.render(React.createElement(BackendSelector, {}));
    rtl.fireEvent.press(await rtl.waitFor(() => settings.getByTestId('backend-opencl-button')));
    await rtl.waitFor(() => { expect(useAppStore.getState().settings.inferenceBackend).toBe('opencl'); });
    settings.unmount();

    // The REAL load path (residency manager registers the text resident at the GPU-aware sizeMB).
    await rtl.act(async () => { await activeModelService.loadTextModel('m'); });
    await rtl.waitFor(() => { expect(view.getByTestId('probe-residents').props.children).toContain('text'); }, { timeout: 10000 });

    // The manager-sheet RAM chip (residency surface) — open the sheet, then read its GB figure.
    await rtl.act(async () => { pressByWalkingUp(view.getByTestId('models-summary')); });
    await rtl.waitFor(() => { expect(view.queryByTestId('models-row-text')).not.toBeNull(); }, { timeout: 10000 });
    const chipGb = ramGb(await rtl.waitFor(() => view.getByTestId('models-row-text-ram'), { timeout: 10000 }));

    // The Select-Model picker "Currently Loaded" RAM label — mounted with the real loaded path.
    const picker = rtl.render(React.createElement(ModelSelectorModal, {
      visible: true, onClose: () => {}, onSelectModel: () => {}, onUnloadModel: () => {}, isLoading: false,
      currentModelPath: llmService.getLoadedModelPath(),
    }));
    const pickerGb = ramGb(await rtl.waitFor(() => picker.getByTestId('currently-loaded-model-ram'), { timeout: 10000 }));

    // Same model, same backend → the two surfaces must show the SAME RAM figure.
    // RED on HEAD: picker=3.0 (fixed 1.5×) vs chip=4.4 (backend-aware 2.2×).
    expect(pickerGb).toBe(chipGb);
  }, 60000);
});
