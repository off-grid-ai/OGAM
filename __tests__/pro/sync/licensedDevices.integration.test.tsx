import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import {
  createLicensedMesh,
  installLicensedPhone,
  registerThisPhone,
} from '../../harness/licensedMesh';
import type { MobileApplicationFixture } from '../../harness/mobileApplicationFixture';

/**
 * How much of your licence is in use, and which devices are using it.
 *
 * The user problem: you replaced a phone, the old one still holds a seat, and you cannot bring the new
 * one on until it lets go. So the mesh has to SHOW what is occupying the licence - a seat you cannot see
 * is a seat you cannot free.
 *
 * The licence stack runs for real - the client, the credential store, the registry, the reconciliation.
 * Only Keygen's HTTP endpoint is substituted, by a fake that really holds machines and really enforces
 * the seat limit, so the number this screen shows is emergent rather than arranged.
 *
 * This used to drive a separate licensed-machines list with a per-machine deactivate button. That UI is
 * gone: capacity and membership are one thing now, shown by the mesh, and this suite follows it.
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

const RETIRED_FINGERPRINT = 'fp-old';

const mesh = createLicensedMesh();
const storedSecrets = new Map<string, string>();
let applicationFixture: MobileApplicationFixture | undefined;
let SyncScreen: typeof import('../../../pro/ui/SyncScreen').SyncScreen;
let thisFingerprint = '';

/** Settings, then Sync - the way a user reaches this screen. */
async function openSync() {
  return render(
    <NavigationContainer>
      <SyncScreen />
    </NavigationContainer>,
  );
}

describe('Settings to Sync licensed-device management', () => {
  beforeAll(() => {
    const { NativeModules } = require('react-native');
    NativeModules.SyncProximityModule = {
      start: jest.fn().mockResolvedValue(undefined),
      rescan: jest.fn().mockResolvedValue(undefined),
      stopBrowsing: jest.fn().mockResolvedValue(undefined),
      startAdvertising: jest.fn().mockResolvedValue(undefined),
      stopAdvertising: jest.fn().mockResolvedValue(undefined),
      stop: jest.fn().mockResolvedValue(undefined),
      updateDevice: jest.fn().mockResolvedValue(undefined),
      connect: jest.fn().mockResolvedValue('connection-1'),
      send: jest.fn(),
      close: jest.fn(),
      addListener: jest.fn(),
      removeListeners: jest.fn(),
    };
  });

  beforeEach(async () => {
    mesh.reset();
    if (!applicationFixture) await AsyncStorage.clear();
    jest.clearAllMocks();

    storedSecrets.clear();
    installLicensedPhone(mesh, { secrets: storedSecrets });
    thisFingerprint = await registerThisPhone(mesh, {
      name: 'My iPhone',
      platform: 'ios',
    });

    // Two devices already on the licence before the app starts: this phone, and one that was replaced.
    mesh.register({
      id: RETIRED_FINGERPRINT,
      name: 'Old Android',
      platform: 'android',
    });

    if (!applicationFixture) {
      const { startMobileApplicationFixture } =
        require('../../harness/mobileApplicationFixture') as typeof import('../../harness/mobileApplicationFixture');
      applicationFixture = await startMobileApplicationFixture({ pro: true });
      ({ SyncScreen } =
        require('../../../pro/ui/SyncScreen') as typeof import('../../../pro/ui/SyncScreen'));
    }
    const reconciliation =
      await applicationFixture.application.sync.reconcileEntitlement('manual');
    if (!reconciliation.ok) {
      throw new Error(
        'message' in reconciliation.failure
          ? reconciliation.failure.message
          : 'Entitlement reconciliation failed.',
      );
    }
  });

  afterAll(async () => {
    await applicationFixture?.dispose();
    mesh.restore();
  });

  it('shows how much of the licence is in use and which device is using the other seat', async () => {
    // The app starts Sync itself on launch (pro/index.ts); there is no toggle for the user to press, so
    // the equivalent arrival here is starting the service. Reconciliation with the licence runs inside it.
    const ui = await openSync();

    // Two installations, so two of the five slots are gone - and the retired phone is one of them.
    await waitFor(() =>
      expect(
        ui.getByText(`2 of ${mesh.maxMachines} devices saved`),
      ).toBeTruthy(),
    );
    expect(ui.getByText('Old Android')).toBeTruthy();

    ui.unmount();
  });

  it('says so when a seat cannot be freed, instead of looking like nothing happened', async () => {
    const ui = await openSync();
    await waitFor(() =>
      expect(
        ui.getByText(`2 of ${mesh.maxMachines} devices saved`),
      ).toBeTruthy(),
    );

    // The provider goes away between opening the screen and confirming - a plane, a captive portal, a
    // bad afternoon at Keygen. The seat cannot be released, and that is worth a sentence: this action
    // used to swallow its failure, so confirming produced no error, no change, and no explanation.
    mesh.keygen.setOffline(true);
    fireEvent.press(ui.getByTestId(`sync-forget-${RETIRED_FINGERPRINT}`));
    fireEvent.press(await waitFor(() => ui.getByText('Evict device')));

    // What matters is that SOMETHING is said and that it names a failure - the sentence itself is the
    // provider's, passed through rather than invented, so the wording is not pinned here.
    const complaint = await waitFor(() => ui.getByRole('alert'));
    expect(String(complaint.props.children)).toMatch(
      /failed|could not|unreachable|unavailable/i,
    );
    // And nothing was quietly half-done: the device still holds its seat on the licence.
    expect(
      mesh.installations().map(({ fingerprint }) => fingerprint),
    ).toContain(RETIRED_FINGERPRINT);

    ui.unmount();
  });

  it('frees the seat a replaced device was holding, at the provider and not only on screen', async () => {
    const ui = await openSync();
    await waitFor(() =>
      expect(
        ui.getByText(`2 of ${mesh.maxMachines} devices saved`),
      ).toBeTruthy(),
    );

    // Forget, then confirm in the sheet - this app never uses a system modal for a confirmation.
    fireEvent.press(ui.getByTestId(`sync-forget-${RETIRED_FINGERPRINT}`));
    fireEvent.press(await waitFor(() => ui.getByText('Evict device')));

    // The seat comes back on the LICENCE, not merely off this list. That is the difference between
    // being able to pair a new phone and being told the mesh is full.
    await waitFor(() =>
      expect(
        ui.getByText(`1 of ${mesh.maxMachines} devices saved`),
      ).toBeTruthy(),
    );
    expect(mesh.installations().map(({ fingerprint }) => fingerprint)).toEqual([
      thisFingerprint,
    ]);
    expect(ui.queryByText('Old Android')).toBeNull();

    ui.unmount();
  });
});
