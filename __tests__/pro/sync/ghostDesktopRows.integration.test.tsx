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
import { useSyncStore } from '../../../pro/sync/syncStore';
import { syncService } from '../../../pro/sync/syncService';
import { pairingSecretStore } from '../../../pro/sync/pairingSecretStore';
import {
  createLicensedMesh,
  installLicensedPhone,
} from '../../harness/licensedMesh';

/**
 * One computer, one row.
 *
 * The user problem: Pro tools listed the same Mac three times - two rows reading "Off Grid AI
 * Desktop" and one "OGAD: Mac (Debug)" - each with its own switch, and only one of them able to
 * connect. A desktop's sync identity is a per-install fingerprint, so a reinstall, a second channel
 * or a seat the licence reclaimed leaves its old credential on the phone forever. The roster was
 * published from those credentials alone, so every dead identity kept drawing a row.
 *
 * The licence registry is what knows which installations are real. The whole licence stack runs
 * here - the client, the credential store, the registry, the reconciliation - with only Keygen's
 * HTTP endpoint and the native sync transports substituted, so which rows survive is emergent.
 *
 * The credential is never destroyed: a held-back pairing comes back whole if its installation
 * returns. Trust is destroyed only by forgetting a device or by a revocation, as it was before.
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
/** The Mac the person is actually using: on the licence, and paired here. */
const LIVE_MAC = 'fp-mac-live';
/** The same Mac after a reinstall: paired here, gone from the licence. */
const GHOST_MAC = 'fp-mac-ghost';
const DESKTOP_NAME = 'Off Grid AI Desktop';

/**
 * Which of the two paired Macs the roster is carrying. This phone puts itself in the roster too,
 * at a moment of its own choosing, and that is not what any of these tests is about.
 */
function pairedMacsInRoster(): string[] {
  return useSyncStore
    .getState()
    .knownDevices.map(device => device.id)
    .filter(id => id === LIVE_MAC || id === GHOST_MAC)
    .sort();
}

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

/** Settings, then Sync - the way a user reaches the paired devices. */
async function openSync() {
  const ui = render(
    <NavigationContainer>
      <AppNavigator />
    </NavigationContainer>,
  );
  fireEvent.press(ui.getByTestId('settings-tab'));
  fireEvent.press(await waitFor(() => ui.getByTestId('open-sync-settings')));
  return ui;
}

describe('a desktop the licence no longer knows stops drawing a row', () => {
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
    const ui = await openSync();

    // Both credentials are here, so without the registry both would be rows under the same name.
    await waitFor(() => expect(pairedMacsInRoster()).toEqual([LIVE_MAC]));
    expect(ui.getAllByText(DESKTOP_NAME)).toHaveLength(1);

    ui.unmount();
  });

  it('keeps the held-back credential, so the computer returns whole if its licence seat does', async () => {
    await syncService.start();
    await waitFor(() => expect(pairedMacsInRoster()).toEqual([LIVE_MAC]));

    // Held back from the roster, not forgotten. Nothing asks the person for the pairing code again.
    expect(pairingSecretStore.get(GHOST_MAC)).toBe(`secret-${GHOST_MAC}`);
    expect(pairingSecretStore.known(GHOST_MAC)).toBeDefined();
  });

  it('keeps every saved computer when the licence cannot be reached', async () => {
    // A cached or unavailable registry is not proof that a device is gone - a plane, a captive
    // portal, a bad afternoon at Keygen. Hiding rows on that answer would lose the live Mac too.
    mesh.keygen.setOffline(true);
    await syncService.start();
    const ui = await openSync();

    await waitFor(() =>
      expect(pairedMacsInRoster()).toEqual([GHOST_MAC, LIVE_MAC].sort()),
    );

    ui.unmount();
  });
});
