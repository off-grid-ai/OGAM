/**
 * Device-aware curated-LiteRT download warning — UI-behavior integration test.
 *
 * SPEC (the fix under test, TextModelsTab.buildFileDownloadHandler):
 *   The curated Gemma 4 E4B LiteRT file carries `confirmDownload` ("may exceed your
 *   device's memory"). The warning must be DEVICE-AWARE, not a static per-model flag:
 *     - a device that can run it (large RAM) → tapping Download shows NO warning sheet,
 *       the download just proceeds;
 *     - a device that CANNOT (small RAM, model exceeds ramGB * modelBudgetFraction) →
 *       the over-budget curated file is NOT offered for download on that device.
 *   Falsification: flipping ONLY the device RAM (12 → 4) flips the rendered outcome —
 *   proving the gate is device-aware, not the old static flag that fired on every device.
 *
 *   GAP surfaced by this test: the fix's warning branch is currently UNREACHABLE via the UI
 *   (the file that would trigger it is exactly the file the detail-list device-fit filter
 *   excludes, and the Download control is disabled when incompatible). See the LOW-RAM case
 *   and the report for the details.
 *
 * Doctrine: mount the REAL ModelsScreen in a real React Navigation stack → arrive at the LiteRT
 * detail view via real taps → press the real Download control → assert the RENDERED CustomAlert
 * text (present/absent). REAL: ModelsScreen, TextModelsTab, ModelCard, CustomAlert, the curated
 * registry, the memory-budget math, hardwareService, huggingFaceService, modelManager,
 * backgroundDownloadService, the app/download stores. FAKE only the phone and the network: an
 * Android phone's RAM sensor, disk and native downloader (installNativeBoundary), the Hugging Face
 * API (hfModelApiServer, serving no repos), the safe-area native module and the documents picker.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';
import { serveHfModelApi } from '../../harness/hfModelApiServer';
import { withNavigator } from '../../harness/realNavigation';

jest.unmock('@react-navigation/native');

jest.mock('react-native-safe-area-context', () => {
  const React2 = require('react');
  const insets = { top: 0, right: 0, bottom: 0, left: 0 };
  const passthrough = ({ children, ...props }: any) => {
    const { View } = require('react-native');
    return <View {...props}>{children}</View>;
  };
  return {
    SafeAreaView: passthrough,
    SafeAreaProvider: passthrough,
    SafeAreaInsetsContext: React2.createContext(insets),
    useSafeAreaInsets: () => insets,
    useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
  };
});

jest.mock('@react-native-documents/picker', () => ({
  pick: jest.fn(),
  types: { allFiles: '*/*' },
  isErrorWithCode: jest.fn(() => false),
  errorCodes: { OPERATION_CANCELED: 'OPERATION_CANCELED' },
}));

(globalThis as any).requestAnimationFrame = (cb: () => void) => setTimeout(cb, 0);

const WARNING_MESSAGE = /may exceed your device's memory/;

/**
 * An Android phone with `totalGB` of RAM (the curated LiteRT parent only appears in the recommended
 * list on Android), Hugging Face recommending nothing, and the Models screen open.
 */
async function openModelsOn(totalGB: number) {
  const boundary = installNativeBoundary({
    download: true, fs: true, ram: { platform: 'android', totalBytes: totalGB * GB, availBytes: (totalGB / 2) * GB },
  });
  serveHfModelApi({ repos: {} });
  const React = require('react');
  const rtl = requireRTL();
  await require('../../../src/services/hardware').hardwareService.refreshMemoryInfo();
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  const utils = rtl.render(withNavigator(React.createElement(ModelsScreen)));

  // The curated LiteRT parent recommended card → its detail view.
  await rtl.waitFor(() => expect(utils.getByText('Gemma 4 LiteRT')).toBeTruthy());
  await rtl.act(async () => { rtl.fireEvent.press(utils.getByText('Gemma 4 LiteRT')); });
  await rtl.waitFor(() => expect(utils.getByTestId('model-detail-screen')).toBeTruthy());
  return { rtl, utils, boundary };
}

describe('curated LiteRT E4B download — device-aware memory warning (rendered)', () => {
  it('HIGH-RAM device (12GB): tapping Download on E4B shows NO warning sheet — it just proceeds', async () => {
    // E4B 3.4GB < 12 * 0.70 = 8.4GB → compatible
    const { rtl, utils, boundary } = await openModelsOn(12);
    const { getByText, queryByText, getByTestId } = utils;

    // The E4B file card renders (it fits) and its Download control is present.
    await rtl.waitFor(() => expect(getByText('Gemma 4 E4B')).toBeTruthy());
    // Precondition: the warning is NOT already on screen before we tap.
    expect(queryByText(WARNING_MESSAGE)).toBeNull();

    // The E4B card is second (E2B sorts first, small-first). Its download control:
    await rtl.act(async () => { rtl.fireEvent.press(getByTestId('file-card-1-download')); });

    // Terminal artifact: no warning sheet appeared — the capable device downloads directly.
    await rtl.waitFor(() => expect(queryByText(WARNING_MESSAGE)).toBeNull());
    // And Cancel / Download anyway (the warning's buttons) are absent.
    expect(queryByText('Download anyway')).toBeNull();
    // The download reached the phone's downloader.
    await rtl.waitFor(() => expect(boundary.download!.active().length).toBeGreaterThan(0));
  });

  it('LOW-RAM device (4GB): the over-budget E4B is not offered — no warning fires because the device-aware gate refuses it upstream (see GAP below)', async () => {
    // E4B 3.4GB > 4 * 0.50 = 2.0GB → exceeds budget
    const { rtl, utils } = await openModelsOn(4);
    const { getByText, queryByText } = utils;

    // Device-aware outcome: at 4GB BOTH curated files (E2B 2.4GB, E4B 3.4GB) exceed the
    // budget (4 * modelBudgetFraction(4)=0.50 → 2.0GB), so the detail list's device-fit
    // filter excludes them and the screen shows the empty-state instead of a file card.
    await rtl.waitFor(() => expect(getByText('No compatible files found for this model.')).toBeTruthy());
    // Therefore the E4B download card never renders on this device...
    expect(queryByText('Gemma 4 E4B')).toBeNull();
    // ...and the "may exceed your device's memory" sheet cannot appear.
    expect(queryByText(WARNING_MESSAGE)).toBeNull();

    /*
     * FALSIFICATION / DEVICE-AWARENESS: this is the SAME screen + SAME curated E4B as the
     * 12GB test; ONLY the RAM sensor changed (12 → 4). At 12GB the E4B card renders and its
     * Download control is present (and pressing it shows no warning); at 4GB the card is gone.
     * The rendered outcome flips on RAM alone — proving the behavior is device-aware, not the
     * old static per-model flag that fired identically on every device.
     *
     * GAP (surfaced, not hidden — see report + docs/GAPS_BACKLOG.md): the fix's warning branch
     * (`curatedEntry?.confirmDownload && exceedsBudget`) is currently UNREACHABLE via the UI. The
     * only file for which `exceedsBudget` is true is exactly the file the detail-list filter
     * (TextModelsTab FlatList: `f.size/GB < ramGB * modelBudgetFraction(ramGB)`) already excludes,
     * and the ModelCard Download control is `disabled` when `!isCompatible`. So no device ever
     * both SHOWS the E4B card AND has `exceedsBudget` true — the confirm sheet never renders.
     * The spec'd low-RAM "warning + Download anyway" needs the curated card shown-with-warning
     * even when over budget (a ModelCard/ filter change out of this task's scope).
     */
  });
});
