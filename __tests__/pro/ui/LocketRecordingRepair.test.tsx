/**
 * LocketRecordingScreen - damaged-clip Repair (Pro) integration test.
 *
 * Drives the REAL LocketRecordingScreen + REAL useRecordingDetail + REAL
 * repairRecording service against the REAL recordings store. Fakes ONLY device
 * boundaries: the vector-icon shims, theme, navigation, toast, and the native
 * AudioNormalizer.repairWavHeader / RecordingPlayer modules. Asserts what the
 * user sees: a recovered clip with a stale header shows a Repair banner, and
 * tapping Repair clears it (the header got rewritten -> needsRepair false).
 *
 * Skips in open-core CI where pro/ is absent.
 */

import React from 'react';
import { NativeModules } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockColors = {
  text: '#000', textMuted: '#999', textSecondary: '#666', textDisabled: '#bbb',
  primary: '#1DB954', error: '#E00', trending: '#F90',
  background: '#FFF', surface: '#F5F5F5', surfaceLight: '#EEE', border: '#E0E0E0', overlay: 'rgba(0,0,0,0.4)',
};

jest.mock('react-native-vector-icons/Feather', () => () => null);
jest.mock('react-native-vector-icons/MaterialIcons', () => () => null);

const mockShadows = new Proxy({}, { get: () => ({}) });
jest.mock('@offgrid/core/theme', () => {
  const actual = jest.requireActual('@offgrid/core/theme');
  return {
    ...actual,
    useTheme: () => ({ colors: mockColors, shadows: mockShadows, isDark: false }),
    // Real useThemedStyles calls factory(colors, shadows) - mirror that here.
    useThemedStyles: (fn: (c: typeof mockColors, s: unknown) => unknown) => fn(mockColors, mockShadows),
  };
});

jest.mock('@offgrid/core/utils/toast', () => ({ showToast: jest.fn() }));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
    useRoute: () => ({ params: { recordingId: 'rec-1' } }),
  };
});

// Native boundary: the header repair + the player module the detail screen mounts.
const repairMock = jest.fn().mockResolvedValue({ alreadyHealthy: false, durationMs: 5000, sizeBytes: 100000 });
(NativeModules as unknown as Record<string, unknown>).AudioNormalizer = {
  repairWavHeader: repairMock,
  normalizeToWav16kMono: jest.fn().mockResolvedValue('/tmp/x.wav'),
};
(NativeModules as unknown as Record<string, unknown>).RecordingPlayer = {
  addListener: jest.fn(),
  removeListeners: jest.fn(),
  load: jest.fn().mockResolvedValue(undefined),
  play: jest.fn(),
  pause: jest.fn(),
  seek: jest.fn(),
  stop: jest.fn(),
};

type ScreenModule = typeof import('@offgrid/pro/locket/screens/LocketRecordingScreen');
type StoreModule = typeof import('@offgrid/pro/locket/stores');

function load(): { screen: ScreenModule; store: StoreModule } | null {
  try {
    return {
      screen: require(['..', '..', '..', 'pro', 'locket', 'screens', 'LocketRecordingScreen'].join('/')),
      store: require(['..', '..', '..', 'pro', 'locket', 'stores'].join('/')),
    };
  } catch {
    return null;
  }
}

const mods = load();
const maybe = mods ? describe : describe.skip;

maybe('LocketRecordingScreen - damaged clip repair', () => {
  const { LocketRecordingScreen } = mods!.screen;
  const { useRecordingsStore } = mods!.store;
  const initial = useRecordingsStore.getState();
  const now = Date.now();

  const damaged = {
    id: 'rec-1',
    path: '/tmp/rec-1.wav',
    startedAt: now - 60_000,
    endedAt: now,
    durationMs: 60_000,
    sizeBytes: 500_000,
    prunedAt: now,
    name: 'Recovered (header damaged)',
    // The recovered-with-stale-header signal set by recovery.
    needsRepair: true,
  };

  beforeEach(() => {
    repairMock.mockClear();
    useRecordingsStore.setState({ recordings: [damaged] });
  });
  afterEach(() => {
    useRecordingsStore.setState(initial, true);
  });

  it('shows the Repair banner for a damaged clip and clears it after repair', async () => {
    const { getByTestId, queryByTestId, getByText } = render(<LocketRecordingScreen />);

    // The user sees the banner - the clip won't play until the header is fixed.
    expect(getByTestId('repair-banner')).toBeTruthy();
    expect(getByText(/Recovered after the app closed/i)).toBeTruthy();

    // Tapping Repair dispatches the real repairRecording service (native header fix).
    fireEvent.press(getByTestId('repair-header'));
    await waitFor(() => expect(repairMock).toHaveBeenCalledWith('/tmp/rec-1.wav'));

    // Header rewritten -> needsRepair cleared -> the banner is gone.
    await waitFor(() => expect(queryByTestId('repair-banner')).toBeNull());
  });
});
