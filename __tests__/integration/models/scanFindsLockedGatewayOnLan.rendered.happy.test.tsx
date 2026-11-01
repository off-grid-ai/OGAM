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
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// Real navigation: the app's own navigator, so the scan's navigate opens the real key entry screen.
jest.unmock('@react-navigation/native');

import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { AppNavigator } from '../../../src/navigation';
import { useAppStore, useRemoteServerStore } from '../../../src/stores';
import { installLanProbe, gatewayModelList, type LanProbeHandle } from '../../harness/lanProbe';

const PHONE_IP = '192.168.1.10';
const MAC_IP = '192.168.1.30';

describe('scanning a network whose Desktop needs an API key', () => {
  let lan: LanProbeHandle;

  beforeEach(() => {
    // A returning person: onboarding was finished on an earlier launch.
    useAppStore.getState().setOnboardingComplete(true);
    useRemoteServerStore.setState({ servers: [], serverHealth: {}, discoveredModels: {} });
    const DeviceInfo = require('react-native-device-info');
    DeviceInfo.isEmulator = jest.fn(async () => false);
    DeviceInfo.getIpAddress = jest.fn(async () => PHONE_IP);
    lan = installLanProbe({ [`${MAC_IP}:7878`]: { paths: ['/v1/'], body: gatewayModelList, locked: true } });
  });

  afterEach(() => lan.uninstall());

  it('adds the computer and opens the key entry for it, instead of reporting an empty network', async () => {
    const navRef = createNavigationContainerRef();
    const ui = render(<NavigationContainer ref={navRef}><AppNavigator /></NavigationContainer>);
    act(() => navRef.navigate('RemoteServers' as never));
    expect(ui.queryByText('No servers yet')).not.toBeNull();

    fireEvent.press(ui.getByText('Scan network'));

    // The computer is added, and its key entry opens over the list.
    await waitFor(() => { expect(navRef.getCurrentRoute()?.name).toBe('RemoteServerEditor'); }, { timeout: 8000 });
    expect(ui.getByDisplayValue(`http://${MAC_IP}:7878`)).toBeTruthy();
    expect(ui.getByTestId('server-needs-key')).toBeTruthy();
    expect(ui.queryByText(/No new servers answered/)).toBeNull();
  }, 20000);
});
