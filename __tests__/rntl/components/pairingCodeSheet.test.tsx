/**
 * Integration (RNTL): PairingCodeSheet scan-to-pair.
 *
 * Guards the approved behavior change: a paired-code sheet can be filled by scanning
 * the other device's QR, not just by typing. A decoded QR carrying a valid pairing
 * code lands on the SAME onPair (syncService.pair) as the typed path, and a QR that
 * is not a pairing code is ignored so the scanner keeps looking.
 *
 * Lives in the private pro/ submodule, loaded via a computed path so the suite skips
 * in open-core CI where pro/ is absent.
 *
 * The real sheet (AppSheet), theme and scanner screen run; only the camera (react-native-vision-camera)
 * is faked, so a test can hand the scanner a decoded QR frame.
 */

import React from 'react';
import { render, fireEvent, act } from '@testing-library/react-native';

jest.mock('react-native-vector-icons/Feather', () => {
  const { Text } = require('react-native');
  return ({ name, ...props }: any) => <Text {...props}>{name}</Text>;
});

// vision-camera is globally stubbed in jest.setup; capture the scan config here so
// the test can simulate a decoded QR frame.
const visionCamera = require('react-native-vision-camera');
let scanConfig: { onCodeScanned: (codes: { value?: string }[]) => void } | null = null;

type SheetModule = typeof import('../../../pro/ui/SyncScreen/PairingCodeSheet');

function load(): SheetModule | null {
  try {
    return require(['..', '..', '..', 'pro', 'ui', 'SyncScreen', 'PairingCodeSheet'].join('/'));
  } catch {
    return null;
  }
}

const mod = load();
const maybe = mod ? describe : describe.skip;

// A valid code: every character is in the pairing alphabet.
const VALID_QR = 'ABCD2345';

maybe('PairingCodeSheet scan-to-pair', () => {
  const { PairingCodeSheet } = mod!;

  const baseProps = () => ({
    visible: true,
    deviceName: 'Studio Mac',
    deviceId: 'studio-mac',
    confirmLabel: 'Pair',
    testIDPrefix: 'sync-test',
    onClose: jest.fn(),
    onPair: jest.fn().mockResolvedValue(undefined),
  });

  beforeEach(() => {
    scanConfig = null;
    jest.spyOn(visionCamera, 'useCodeScanner').mockImplementation((cfg: any) => {
      scanConfig = cfg;
      return cfg;
    });
  });

  it('offers a Scan button that opens the camera scanner', () => {
    const { getByTestId, queryByText, getByText } = render(
      <PairingCodeSheet {...baseProps()} />,
    );
    expect(queryByText('Camera access needed')).toBeNull();
    fireEvent.press(getByTestId('sync-test-scan'));
    // Global vision-camera mock reports no permission, so the scanner asks for it -
    // proof the scanner surface mounted.
    expect(getByText('Camera access needed')).toBeTruthy();
  });

  it('hides the pairing sheet while the scanner is open (one modal at a time)', () => {
    // iOS presents one modal at a time; the sheet must yield so the scanner can show.
    const { getByTestId, queryByTestId } = render(<PairingCodeSheet {...baseProps()} />);
    expect(queryByTestId('sync-test-input')).toBeTruthy();
    fireEvent.press(getByTestId('sync-test-scan'));
    expect(queryByTestId('sync-test-input')).toBeNull();
  });

  it('pairs from a scanned QR via the same onPair as typing', async () => {
    const props = baseProps();
    const { getByTestId } = render(<PairingCodeSheet {...props} />);
    fireEvent.press(getByTestId('sync-test-scan'));
    await act(async () => {
      scanConfig!.onCodeScanned([{ value: VALID_QR }]);
    });
    expect(props.onPair).toHaveBeenCalledWith(VALID_QR);
  });

  it('ignores a QR that is not a pairing code', async () => {
    const props = baseProps();
    const { getByTestId } = render(<PairingCodeSheet {...props} />);
    fireEvent.press(getByTestId('sync-test-scan'));
    await act(async () => {
      scanConfig!.onCodeScanned([{ value: 'https://example.com/not-a-code' }]);
    });
    expect(props.onPair).not.toHaveBeenCalled();
  });
});
