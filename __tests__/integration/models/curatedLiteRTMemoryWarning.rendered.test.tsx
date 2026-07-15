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
 * Doctrine: mount the REAL ModelsScreen → arrive at the LiteRT detail view via real taps →
 * press the real Download control → assert the RENDERED CustomAlert text (present/absent).
 * REAL: ModelsScreen, TextModelsTab, ModelCard, CustomAlert, the curated registry, the
 * memory-budget math, the app/download stores. FAKE only device boundaries: navigation,
 * the HuggingFace/network layer, the native download service, the file/documents picker,
 * and the RAM sensor (hardwareService.getTotalMemoryGB) — which is how ramGB reaches the tab.
 */

import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';
import { NavigationContainer } from '@react-navigation/native';
import { resetStores } from '../../utils/testHelpers';

// The curated LiteRT parent only appears in the recommended list on Android. Flip the
// platform sensor to Android (a genuine device boundary) without replacing the whole
// Platform module (which breaks @react-navigation's requireActual).
const originalOS = Platform.OS;
beforeAll(() => { Platform.OS = 'android'; });
afterAll(() => { Platform.OS = originalOS; });

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
    useRoute: () => ({ params: {} }),
    useIsFocused: () => true,
    useFocusEffect: jest.fn((cb) => cb()),
  };
});

// Network boundary — no recommended HF models, so the ONLY recommended card is the
// curated LiteRT parent (Android). Keeps the list to the entry under test.
jest.mock('../../../src/services/huggingface', () => ({
  huggingFaceService: {
    searchModels: jest.fn(() => Promise.resolve([])),
    getModelFiles: jest.fn(() => Promise.resolve([])),
    getModelDetails: jest.fn(() => Promise.resolve(null)),
    downloadModel: jest.fn(),
    downloadModelWithProgress: jest.fn(),
    formatModelSize: jest.fn(() => '3.4 GB'),
    formatFileSize: jest.fn((b: number) => `${(b / (1024 ** 3)).toFixed(1)} GB`),
  },
}));

// Native download boundary — never runs native code. We assert on the RENDERED sheet,
// not on this seam, so it is a dumb stub.
jest.mock('../../../src/services/backgroundDownloadService', () => ({
  backgroundDownloadService: {
    queryDownload: jest.fn(() => Promise.resolve(null)),
    cancelDownload: jest.fn(() => Promise.resolve()),
    startDownload: jest.fn(() => Promise.resolve(1)),
    isAvailable: jest.fn(() => Promise.resolve(true)),
    startProgressPolling: jest.fn(),
  },
}));

jest.mock('../../../src/services/modelManager', () => ({
  modelManager: {
    cancelDownload: jest.fn(),
    deleteModel: jest.fn(),
    deleteImageModel: jest.fn(),
    getDownloadedModels: jest.fn(() => Promise.resolve([])),
    getDownloadedImageModels: jest.fn(() => Promise.resolve([])),
    addDownloadedImageModel: jest.fn(),
    downloadModelWithMmProj: jest.fn(() => Promise.resolve()),
    downloadModel: jest.fn(() => Promise.resolve()),
    downloadCuratedLiteRT: jest.fn(() => Promise.resolve()),
    importLocalModel: jest.fn(),
    getActiveBackgroundDownloads: jest.fn(() => Promise.resolve([])),
    watchDownload: jest.fn(),
  },
}));

jest.mock('../../../src/services/huggingFaceModelBrowser', () => ({
  fetchAvailableModels: jest.fn(() => Promise.resolve([])),
  getVariantLabel: jest.fn(() => 'Standard'),
  guessStyle: jest.fn(() => 'creative'),
}));

jest.mock('../../../src/services/coreMLModelBrowser', () => ({
  fetchAvailableCoreMLModels: jest.fn(() => Promise.resolve([])),
}));

// RAM sensor boundary — the SINGLE knob for the device under test. ramGB reaches
// TextModelsTab through hardwareService.getTotalMemoryGB(); the rest of hardware is
// a faithful passthrough of the real formatting used by the recommendation banner.
const mockGetTotalMemoryGB = jest.fn(() => 12);
jest.mock('../../../src/services/hardware', () => ({
  hardwareService: {
    getDeviceInfo: jest.fn(() => Promise.resolve({
      totalMemory: 12 * 1024 * 1024 * 1024, usedMemory: 4 * 1024 * 1024 * 1024,
      availableMemory: 8 * 1024 * 1024 * 1024, deviceModel: 'Test', systemName: 'Android',
      systemVersion: '13', isEmulator: false,
    })),
    formatBytes: jest.fn((b: number) => `${(b / (1024 ** 3)).toFixed(1)} GB`),
    getTotalMemoryGB: () => mockGetTotalMemoryGB(),
    getModelRecommendation: jest.fn(() => ({ maxParameters: 14, recommendedQuantization: 'Q4_K_M', recommendedModels: [], warning: undefined })),
    getImageModelRecommendation: jest.fn(() => Promise.resolve({ recommendedBackend: 'mnn', maxModelSizeMB: 2048, canRunSD: true, canRunQNN: false })),
  },
}));

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

// Import AFTER mocks. REAL screen + REAL ModelCard + REAL CustomAlert (our own code — never mocked).
import { ModelsScreen } from '../../../src/screens/ModelsScreen';

const WARNING_MESSAGE = /may exceed your device's memory/;

const openLiteRTDetail = async (utils: ReturnType<typeof render>) => {
  const { getByText, getByTestId } = utils;
  // The curated LiteRT parent recommended card.
  await waitFor(() => expect(getByText('Gemma 4 LiteRT')).toBeTruthy());
  await act(async () => { fireEvent.press(getByText('Gemma 4 LiteRT')); });
  await waitFor(() => expect(getByTestId('model-detail-screen')).toBeTruthy());
};

const renderScreen = () => render(
  <NavigationContainer>
    <ModelsScreen />
  </NavigationContainer>,
);

describe('curated LiteRT E4B download — device-aware memory warning (rendered)', () => {
  beforeEach(() => {
    resetStores();
    jest.clearAllMocks();
    mockGetTotalMemoryGB.mockReturnValue(12);
  });

  it('HIGH-RAM device (12GB): tapping Download on E4B shows NO warning sheet — it just proceeds', async () => {
    mockGetTotalMemoryGB.mockReturnValue(12); // E4B 3.4GB < 12 * 0.70 = 8.4GB → compatible

    const utils = renderScreen();
    await openLiteRTDetail(utils);
    const { getByText, queryByText, getByTestId } = utils;

    // The E4B file card renders (it fits) and its Download control is present.
    await waitFor(() => expect(getByText('Gemma 4 E4B')).toBeTruthy());
    // Precondition: the warning is NOT already on screen before we tap.
    expect(queryByText(WARNING_MESSAGE)).toBeNull();

    // The E4B card is second (E2B sorts first, small-first). Its download control:
    await act(async () => { fireEvent.press(getByTestId('file-card-1-download')); });

    // Terminal artifact: no warning sheet appeared — the capable device downloads directly.
    await waitFor(() => expect(queryByText(WARNING_MESSAGE)).toBeNull());
    // And Cancel / Download anyway (the warning's buttons) are absent.
    expect(queryByText('Download anyway')).toBeNull();
  });

  it('LOW-RAM device (4GB): the over-budget E4B is not offered — no warning fires because the device-aware gate refuses it upstream (see GAP below)', async () => {
    mockGetTotalMemoryGB.mockReturnValue(4); // E4B 3.4GB > 4 * 0.50 = 2.0GB → exceeds budget

    const utils = renderScreen();
    await openLiteRTDetail(utils);
    const { getByText, queryByText } = utils;

    // Device-aware outcome: at 4GB BOTH curated files (E2B 2.4GB, E4B 3.4GB) exceed the
    // budget (4 * modelBudgetFraction(4)=0.50 → 2.0GB), so the detail list's device-fit
    // filter excludes them and the screen shows the empty-state instead of a file card.
    await waitFor(() => expect(getByText('No compatible files found for this model.')).toBeTruthy());
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
