import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PERSONAL_MESH_DEVICE_CAP } from '@offgrid/sync';

import { AppNavigator } from '../../../src/navigation/AppNavigator';
import {
  registerScreen,
  _clearScreensForTesting,
} from '../../../src/navigation/screenRegistry';
import { _clearSectionsForTesting } from '../../../src/components/settings/sectionRegistry';
import { useAppStore } from '../../../src/stores/appStore';
import { createDownloadedModel } from '../../utils/factories';
import { SyncScreen } from '../../../pro/ui/SyncScreen';
import {
  selectSyncControlCenter,
  useSyncStore,
} from '../../../pro/sync/syncStore';
import { syncService } from '../../../pro/sync/syncService';
import { pairingSecretStore } from '../../../pro/sync/pairingSecretStore';
import {
  createLicensedMesh,
  installLicensedPhone,
} from '../../harness/licensedMesh';

/**
 * One computer, one row.
 *
 * Pro tools listed the same Mac three times - two rows reading "Off Grid AI Desktop" and one
 * "OGAD: Mac (Debug)" - because it built its own list from saved credentials, and a desktop keeps
 * one credential per install. The shared projection is the roster authority and already drops a
 * machine the licence no longer knows; the Sync screen was reading it and was right all along.
 *
 * So this proves one thing: both surfaces name the same computers.
 */

jest.unmock('@react-navigation/native');

jest.mock('react-native-tcp-socket', () => {
  const {
    createNativeTcpBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});

jest.mock('react-native-zeroconf', () => {
  const {
    createNativeDiscoveryBoundary,
  } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

const THIS_FINGERPRINT = 'fp-this-phone';
/** The Mac the person is using: on the licence, and paired here. */
const LIVE_MAC = 'fp-mac-live';
/** The same Mac after a reinstall: paired here, gone from the licence. */
const GHOST_MAC = 'fp-mac-ghost';
const DESKTOP_NAME = 'Off Grid AI Desktop';

const mesh = createLicensedMesh();
const storedSecrets = new Map<string, string>();

/** Pair a desktop with this phone, the way the pairing flow leaves the store. */
async function pairDesktop(id: string, port: number): Promise<void> {
  const device = {
    id,
    name: DESKTOP_NAME,
    platform: 'macos' as const,
    version: '1.0.0',
    host: '192.168.1.34',
    port,
    sharedSecret: `secret-${id}`,
    pairedAt: 1,
  };
  await pairingSecretStore.beginPairing(device);
  await pairingSecretStore.commitPairing(device);
}

describe('Pro tools and Sync name the same computers', () => {
  beforeEach(async () => {
    mesh.reset(PERSONAL_MESH_DEVICE_CAP);
    await syncService.stop();
    await AsyncStorage.clear();
    jest.clearAllMocks();
    _clearScreensForTesting();
    _clearSectionsForTesting();
    registerScreen({ name: 'Sync', component: SyncScreen });

    const app = useAppStore.getState();
    app.setOnboardingComplete(true);
    app.setDownloadedModels([createDownloadedModel()]);
    app.setThemeMode('dark');
    app.setHasRegisteredPro(true);
    app.setProActive(true);
    useSyncStore.getState().reset();

    storedSecrets.clear();
    installLicensedPhone(mesh, {
      fingerprint: THIS_FINGERPRINT,
      secrets: storedSecrets,
    });

    // The licence knows this phone and ONE Mac. The reinstalled identity is not on it.
    mesh.register({ id: THIS_FINGERPRINT, name: 'My iPhone', platform: 'ios' });
    mesh.register({ id: LIVE_MAC, name: DESKTOP_NAME, platform: 'macos' });

    // The phone, however, holds a credential for both.
    await pairingSecretStore.load();
    await pairDesktop(LIVE_MAC, 37878);
    await pairDesktop(GHOST_MAC, 37879);
  });

  afterEach(async () => {
    mesh.restore();
    await syncService.stop();
    _clearScreensForTesting();
    _clearSectionsForTesting();
  });

  it('shows the computer once, not once per identity it has ever had', async () => {
    await syncService.start();
    const ui = render(
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>,
    );
    fireEvent.press(ui.getByTestId('settings-tab'));
    fireEvent.press(await waitFor(() => ui.getByTestId('open-sync-settings')));

    // Both credentials are saved, so a list built from them would name this Mac twice.
    await waitFor(() =>
      expect(
        selectSyncControlCenter(useSyncStore.getState())
          .allDevices.map(device => device.id)
          .filter(id => id === LIVE_MAC || id === GHOST_MAC),
      ).toEqual([LIVE_MAC]),
    );
    expect(ui.getAllByText(DESKTOP_NAME)).toHaveLength(1);

    ui.unmount();
  });
});
