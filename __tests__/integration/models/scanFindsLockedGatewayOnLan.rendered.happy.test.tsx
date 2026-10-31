/**
 * Scanning a network whose Off Grid AI Desktop asks for an API key.
 *
 * SPEC (OGAM user's view): the computer is on my Wi-Fi but its gateway needs a key. The scan must not
 * report "No new servers"; it adds the computer to my list and takes me to where I enter its key.
 *
 * Device ground truth (2026-10-27): the Mac answered 401 to the phone; the saved key was rejected.
 *
 * Fakes sit at the device boundary only: this phone's address and `fetch` (the network).
 */
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, goBack: () => {}, setOptions: () => {}, addListener: () => () => {} }),
  useIsFocused: () => true,
  useFocusEffect: () => {},
}));

import { RemoteServersScreen } from '../../../src/screens/RemoteServersScreen';
import { useRemoteServerStore } from '../../../src/stores';
import { installLanProbe, gatewayModelList, type LanProbeHandle } from '../../harness/lanProbe';

const PHONE_IP = '192.168.1.10';
const MAC_IP = '192.168.1.30';

describe('scanning a network whose Desktop needs an API key', () => {
  let lan: LanProbeHandle;

  beforeEach(() => {
    mockNavigate.mockClear();
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {} });
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => false);
    DeviceInfo.getIpAddress = jest.fn(async () => PHONE_IP);
    lan = installLanProbe({ [`${MAC_IP}:7878`]: { paths: ['/v1/'], body: gatewayModelList, locked: true } });
  });

  afterEach(() => lan.uninstall());

  it('adds the computer and opens the key entry for it, instead of reporting an empty network', async () => {
    const ui = render(<RemoteServersScreen />);
    expect(ui.queryByText('No servers yet')).not.toBeNull();

    fireEvent.press(ui.getByText('Scan network'));

    await waitFor(() => { expect(ui.queryByText(`http://${MAC_IP}:7878`)).not.toBeNull(); }, { timeout: 8000 });
    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('RemoteServerEditor', expect.objectContaining({ needsKey: true }));
    });
    expect(ui.queryByText(/No new servers answered/)).toBeNull();
  }, 20000);
});
