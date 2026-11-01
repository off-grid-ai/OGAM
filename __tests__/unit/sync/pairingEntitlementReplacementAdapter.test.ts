import { PersonalMeshEntitlementError } from '@offgrid/sync';
import { createPairingEntitlementReplacementAdapter } from '../../../pro/sync/pairingEntitlementReplacementAdapter';
import type { PairedDevice } from '@offgrid/sync';
import { pairingSecretStore } from '../../../pro/sync/pairingSecretStore';
import { resetKeychain } from '../../harness/keyedRemoteServer';

// The phone's keychain: it really stores what the pairing store persists.
jest.mock('react-native-keychain', () => require('../../harness/deviceKeychain').deviceKeychainModule());

/**
 * The local half of an eviction, in the four steps it is actually driven through.
 *
 * Worth testing directly for a reason beyond coverage: in the app today, ONE of these branches is the
 * only one that ever runs. The eviction announces its registry change before it finalises, that
 * announcement drives reconciliation, and reconciliation resumes committed evictions - so by the time the
 * caller finalises, the transaction is already gone and the no-op branch answers. The lines that do the
 * real work are unreachable in that flow.
 *
 * That makes this the only place their behaviour is stated. If the announcement is ever moved (and it
 * should be - see docs/GAPS_BACKLOG.md), these are the rules the flow has to come back to.
 *
 * The adapter and the real pairing store run. Trust is written by pairing; transactions are opened,
 * committed and rolled back through the adapter itself.
 */
describe('the local half of an eviction', () => {
  const installation = {
    installationId: 'machine-1',
    syncDeviceId: 'desktop-peer',
    deviceName: 'Off Grid AI Desktop',
    platform: 'macos' as const,
    lastActiveAt: 1_700_000_000_000,
    createdAt: 1_700_000_000_000,
  };
  const desktop: PairedDevice = {
    id: 'desktop-peer', name: 'Off Grid AI Desktop', platform: 'macos', version: '1',
    host: '192.168.1.20', port: 7878, sharedSecret: 'secret', membershipId: 'generation-7', pairedAt: 1,
  };

  const retired: Array<[string, string | undefined]> = [];
  const adapter = createPairingEntitlementReplacementAdapter(
    async (deviceId, membershipId) => {
      retired.push([deviceId, membershipId]);
    },
  );

  beforeEach(async () => {
    retired.length = 0;
    resetKeychain();
    pairingSecretStore.resetCache();
    await pairingSecretStore.load();
  });

  /** This phone paired with the desktop: it holds trust under membership generation-7. */
  async function pairedWithDesktop() {
    await pairingSecretStore.beginPairing(desktop);
    await pairingSecretStore.commitPairing(desktop);
  }

  it('opens the transaction in the store, carrying the membership this phone trusts', async () => {
    await pairedWithDesktop();

    const id = await adapter.prepareEviction(installation);

    expect(pairingSecretStore.capacityReplacement(id)).toEqual(expect.objectContaining({
      id, installation, membershipId: 'generation-7', state: 'prepared',
    }));
  });

  it('retires the trust the transaction was carrying, then closes it', async () => {
    await pairedWithDesktop();
    const id = await adapter.prepareEviction(installation);
    await adapter.commitEviction(id);

    await adapter.finalizeEviction(id);

    expect(retired).toEqual([['desktop-peer', 'generation-7']]);
    expect(pairingSecretStore.capacityReplacement(id)).toBeUndefined();
  });

  it('closes an eviction that had no trust to retire', async () => {
    const id = await adapter.prepareEviction(installation);
    await adapter.commitEviction(id);

    await adapter.finalizeEviction(id);

    // Evicting a device this phone never paired with: the seat is released and there is no membership to
    // withdraw. `undefined` reaches finalizeMembershipEviction, which owns the rule that it is a no-op.
    expect(retired).toEqual([['desktop-peer', undefined]]);
    expect(pairingSecretStore.capacityReplacement(id)).toBeUndefined();
  });

  it('treats an already-closed transaction as done rather than broken', async () => {
    await pairedWithDesktop();
    const id = await adapter.prepareEviction(installation);
    await adapter.commitEviction(id);
    await adapter.finalizeEviction(id);
    retired.length = 0;

    await expect(adapter.finalizeEviction(id)).resolves.toBeUndefined();

    // This is the branch the app actually takes. Reporting a failure here is what made a completed
    // eviction announce `replacement_failed` after it had entirely succeeded.
    expect(retired).toEqual([]);
  });

  it('still refuses to close a transaction that was never committed', async () => {
    await pairedWithDesktop();
    const id = await adapter.prepareEviction(installation);

    // Tolerating a MISSING transaction is not the same as tolerating an unfinished one: a prepared record
    // means the registry side never happened, and finishing anyway would retire trust for a seat that was
    // never released.
    await expect(adapter.finalizeEviction(id)).rejects.toThrow(PersonalMeshEntitlementError);
    expect(retired).toEqual([]);
    expect(pairingSecretStore.capacityReplacement(id)?.state).toBe('prepared');
  });

  it('rolls back and commits through the store', async () => {
    const abandoned = await adapter.prepareEviction(installation);
    const kept = await adapter.prepareEviction(installation);

    await adapter.rollbackEviction(abandoned);
    await adapter.commitEviction(kept);

    expect(pairingSecretStore.capacityReplacement(abandoned)).toBeUndefined();
    expect(pairingSecretStore.capacityReplacement(kept)?.state).toBe('committed');
  });
});
