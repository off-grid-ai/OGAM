/**
 * Device-aware curated-LiteRT download warning — rendered integration test.
 *
 * SPEC (the OGAM user's view): the curated Gemma 4 E4B LiteRT file carries a memory warning
 * ("may exceed your device's memory"). The warning is DEVICE-AWARE — Shared owns the rule
 * (`curatedLiteRTDownloadWarning` = entry.confirmDownload && fileExceedsBudget(size, ramGB)),
 * Mobile only supplies the device RAM fact:
 *   - a device that can run it (12GB) → tapping Download on E4B shows NO warning; it proceeds;
 *   - a device that cannot (4GB) → E4B is still OFFERED on the onboarding Recommended list
 *     (the over-budget E2B, which has no warning entry, is hidden) and tapping it renders the
 *     "Warning" sheet with Cancel / Download anyway; Cancel dismisses it.
 *   - in the full detail view at 4GB every file stays visible, marked Too large and disabled.
 * Falsification: flipping ONLY the device RAM (12 → 4) flips every rendered outcome.
 *
 * Doctrine: REAL ModelsScreen (embedded = the onboarding surface, and the full detail view),
 * REAL TextModelsTab / ModelCard / CustomAlert, REAL Shared application + download coordinator.
 * FAKE only the device boundary: native download + fs + RAM (installNativeBoundary) and the
 * HuggingFace network transport. No Off Grid code is mocked; the old coordinatedDownloadBridge
 * / modelLibrary / hardware jest.mocks are gone — Shared owns download state and the advice.
 */
import { installNativeBoundary, requireRTL, GB } from '../../harness/nativeBoundary';

let fixture: import("../../harness/mobileApplicationFixture").MobileApplicationFixture | undefined;
afterEach(async () => { await fixture?.dispose(); fixture = undefined; });

// Boots the REAL Mobile composition root (Shared application + download coordinator) over the fakes.
async function bootApplication() {
  const { startMobileApplicationFixture } = require("../../harness/mobileApplicationFixture") as typeof import("../../harness/mobileApplicationFixture");
  fixture = await startMobileApplicationFixture();
}

const WARNING_MESSAGE = /may exceed your device's memory/;

function mockNetwork() {
  // Network boundary: no HF recommended/trending models so the curated cards are the only entries.
  jest.doMock('../../../src/services/huggingface', () => ({
    huggingFaceService: {
      searchModels: jest.fn(async () => []),
      getModelFiles: jest.fn(async () => []),
      getModelDetails: jest.fn(async () => null),
      getDownloadUrl: (m: string, f: string, r = 'main') => `https://hf.co/${m}/resolve/${r}/${f}`,
      formatModelSize: jest.fn(() => '3.4 GB'),
      formatFileSize: jest.fn((b: number) => `${(b / GB).toFixed(1)} GB`),
    },
  }));
}

async function mountOnboarding(totalGB: number) {
  installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: totalGB * GB, availBytes: Math.max(1, totalGB - 2) * GB } });
  mockNetwork();
  await bootApplication();
  const React = require("react");
  const rtl = requireRTL();
  const { hardwareService } = require('../../../src/services/hardware');
  const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
  await hardwareService.refreshMemoryInfo();
  expect(hardwareService.getTotalMemoryGB()).toBeCloseTo(totalGB, 0);
  const utils = rtl.render(React.createElement(ModelsScreen, { embedded: true }));
  await rtl.waitFor(() => expect(utils.getByTestId('embedded-models-screen')).toBeTruthy(), { timeout: 6000 });
  return { ...utils, rtl };
}

describe('curated LiteRT E4B download — device-aware memory warning (rendered)', () => {
  it('HIGH-RAM device (12GB): both curated cards render; tapping Download on E4B shows NO warning sheet', async () => {
    const { getAllByText, queryByText, getByTestId, rtl } = await mountOnboarding(12); // budget 12*0.70 = 8.4GB > 3.66GB
    const { fireEvent, waitFor, act } = rtl;

    // The card renders the curated display name (title + file chip), so match all occurrences.
    await waitFor(() => expect(getAllByText("Gemma 4 E4B").length).toBeGreaterThan(0), { timeout: 6000 });
    expect(getAllByText("Gemma 4 E2B").length).toBeGreaterThan(0); // the smaller sibling also fits → offered
    expect(getByTestId("onboarding-litert-model-0")).toBeTruthy();
    expect(queryByText(WARNING_MESSAGE)).toBeNull();

    // E4B is the second onboarding card (catalog order E2B, E4B).
    await act(async () => { fireEvent.press(getByTestId('onboarding-litert-model-1')); });

    // Terminal artifact: no warning sheet — the capable device downloads directly.
    await waitFor(() => expect(queryByText(WARNING_MESSAGE)).toBeNull());
    expect(queryByText('Download anyway')).toBeNull();
    expect(queryByText('Warning')).toBeNull();
  }, 30000);

  it('LOW-RAM device (4GB): E2B is hidden, E4B is offered WITH the rendered warning sheet; Cancel dismisses it', async () => {
    const { getByText, queryByText, getByTestId, rtl } = await mountOnboarding(4); // budget 4*0.50 = 2.0GB < both files
    const { fireEvent, waitFor, act } = rtl;

    // Device-aware offer: the over-budget E2B has no warning entry → not offered; E4B → offered guarded.
    await waitFor(() => expect(getByText('Gemma 4 E4B')).toBeTruthy(), { timeout: 6000 });
    expect(queryByText('Gemma 4 E2B')).toBeNull();
    expect(queryByText(WARNING_MESSAGE)).toBeNull();

    await act(async () => { fireEvent.press(getByTestId('onboarding-litert-model-0')); });

    // Terminal artifact: Shared's advisory fires → the REAL CustomAlert renders the warning.
    await waitFor(() => expect(getByText(WARNING_MESSAGE)).toBeTruthy());
    expect(getByText('Warning')).toBeTruthy();
    expect(getByText('Download anyway')).toBeTruthy();

    await act(async () => { fireEvent.press(getByText('Cancel')); });
    await waitFor(() => expect(queryByText(WARNING_MESSAGE)).toBeNull());
    expect(queryByText('Download anyway')).toBeNull();
  }, 30000);

  it('LOW-RAM device (4GB), full detail view: lists both files as too large', async () => {
    installNativeBoundary({ download: true, fs: true, ram: { platform: 'android', totalBytes: 4 * GB, availBytes: 3 * GB } });
    mockNetwork();
    await bootApplication();
    const React = require("react");
    const { render, fireEvent, waitFor, act } = requireRTL();
    const { hardwareService } = require('../../../src/services/hardware');
    const { ModelsScreen } = require('../../../src/screens/ModelsScreen');
    await hardwareService.refreshMemoryInfo();

    const { getAllByText, getByText, queryByText, getByTestId } = render(React.createElement(ModelsScreen, {}));
    await waitFor(() => expect(getByText('Gemma 4 LiteRT')).toBeTruthy(), { timeout: 6000 });
    await act(async () => { fireEvent.press(getByText('Gemma 4 LiteRT')); });
    await waitFor(() => expect(getByTestId('model-detail-screen')).toBeTruthy(), { timeout: 4000 });

    await waitFor(() => expect(getByText('Gemma 4 E4B')).toBeTruthy(), { timeout: 6000 });
    expect(getByText('Gemma 4 E2B')).toBeTruthy();
    expect(getAllByText(/Too large/)).toHaveLength(2);
    expect(
      getByTestId('file-card-0').props.accessibilityState.disabled,
    ).toBe(true);
    expect(
      getByTestId('file-card-1').props.accessibilityState.disabled,
    ).toBe(true);
    expect(queryByText(WARNING_MESSAGE)).toBeNull();
  }, 30000);
});
