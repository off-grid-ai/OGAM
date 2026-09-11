import {
  createSyncApplication,
  type SyncApplication,
  type SyncApplicationPorts,
} from '@offgrid/sync';
import {proIsPresent} from '../helpers/requirePro';

const describePro = proIsPresent() ? describe : describe.skip;

/**
 * A stopped Devices screen still sends commands to the Shared Sync application.
 * Shared owns every refusal and publishes it as typed state. Mobile only renders that state.
 * These fakes are the network and persistence boundaries that the stopped journey never reaches.
 */
function createStoppedSync(): SyncApplication {
  const ports: SyncApplicationPorts = {
    localDevice: {
      id: 'this-phone',
      name: 'This phone',
      platform: 'ios',
      version: '1',
      host: '0.0.0.0',
      port: 41234,
    },
    transport: {
      listen: async () => undefined,
      connect: async () => {
        throw new Error('A stopped Sync application must not connect.');
      },
      stop: async () => undefined,
    },
    discovery: {
      start: async () => undefined,
      stop: async () => undefined,
      rescan: async () => undefined,
      advertise: async () => undefined,
      stopAdvertising: async () => undefined,
      onDeviceFound: () => undefined,
      onDeviceLost: () => undefined,
    },
    persistence: {
      load: async () => ({
        pairedDevices: [],
        discoverable: true,
        browsing: true,
      }),
      savePreferences: async () => undefined,
      removePaired: async () => undefined,
      pairing: {
        begin: async () => undefined,
        commit: async () => undefined,
        rollback: async () => undefined,
      },
    },
  };

  return createSyncApplication(ports, () => undefined);
}

describePro('the Devices screen while Sync is not running', () => {
  it.each([
    ['rescan', (sync: SyncApplication) => sync.rescan()],
  ] as const)('refuses %s through the typed Shared outcome', async (operation, command) => {
    const sync = createStoppedSync();

    const outcome = await command(sync);

    expect(outcome).toEqual({ok: false, failure: {kind: 'not_running'}});
    expect(sync.snapshot().lastFailure).toEqual({
      operation,
      failure: {kind: 'not_running'},
    });
  });

  it('allows local unpair while Sync is stopped without fabricating a connection change', async () => {
    const sync = createStoppedSync();
    const connections = sync.snapshot().connections;

    await expect(sync.disconnect('the-mac')).resolves.toEqual({
      ok: true,
      value: undefined,
    });

    expect(sync.snapshot().connections).toBe(connections);
    expect(sync.mesh.connectedDeviceIds()).toEqual([]);
    expect(sync.snapshot().lastFailure).toBeNull();
  });

  it('reports a missing membership revocation as not actionable', async () => {
    const sync = createStoppedSync();

    await expect(sync.retryMembershipRevocation('the-mac')).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'membership_revocation_not_actionable',
        action: 'retry',
        reason: 'No pending membership revocation exists for this device.',
      },
    });
  });

  it('reports a missing revocation dismissal as not actionable', async () => {
    const sync = createStoppedSync();

    await expect(sync.dismissMembershipRevocation('revocation-1')).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'membership_revocation_not_actionable',
        action: 'dismiss',
        reason: 'The membership revocation cannot be dismissed.',
      },
    });
  });

  it('reports a missing pairing cancellation as not actionable', async () => {
    const sync = createStoppedSync();

    await expect(sync.cancelPairing('the-mac')).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'pairing_not_actionable',
        action: 'cancel',
        reason: 'No active pairing attempt exists for this device.',
      },
    });
  });

  it('reports a missing pairing dismissal as not actionable', async () => {
    const sync = createStoppedSync();

    await expect(sync.dismissPairingAttempt('attempt-1')).resolves.toEqual({
      ok: false,
      failure: {
        kind: 'pairing_not_actionable',
        action: 'dismiss',
        reason: 'The pairing attempt is missing or is not terminal.',
      },
    });
  });
});
