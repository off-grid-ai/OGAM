import type { PairedDevice } from '@offgrid/sync';
import type { MobilePairingEntitlementAdapterOptions } from '../../../pro/sync/pairingEntitlementCredentialAdapter';

type Forget = typeof import('../../../pro/sync/forgetUnregisteredDevice');

/**
 * Dropping local trust for a device the licence has nothing registered for.
 *
 * This is the escape hatch that makes a stale row removable at all. A phone that was reinstalled comes
 * back under a new identity, so its old installation can never be matched again - and without this the
 * eviction of that leftover would only ever throw, leaving a row that cannot be got rid of.
 *
 * It is small and it is a decision, which is why it is worth stating: retire the membership if there IS
 * one, and do nothing at all if the trust or the owner is missing. Doing nothing quietly is right here -
 * there is no membership to retire, so there is no failure to report either.
 *
 * The phone's keychain is the boundary (an in-memory vault). The pairing store runs for real, and a device is
 * trusted the way the app trusts one: staged, then committed.
 */
describe('forgetting a device the licence does not know', () => {
  const forgotten: Array<[string, string]> = [];
  const owner = {
    forget: async (deviceId: string, membershipId: string) => {
      forgotten.push([deviceId, membershipId]);
    },
  };
  const optionsWith = (
    membershipOwner: () => unknown,
  ): MobilePairingEntitlementAdapterOptions =>
    ({ membershipOwner } as unknown as MobilePairingEntitlementAdapterOptions);

  let forgetUnregisteredDevice: Forget['forgetUnregisteredDevice'];

  /** A fresh app on a phone whose keychain holds nothing yet. */
  beforeEach(async () => {
    forgotten.length = 0;
    jest.resetModules();
    const vault = new Map<string, string>();
    const keychain = require('react-native-keychain');
    keychain.getGenericPassword.mockImplementation(async ({ service }: { service: string }) =>
      vault.has(service) ? { username: 'pairings', password: vault.get(service) } : false,
    );
    keychain.setGenericPassword.mockImplementation(
      async (_user: string, password: string, { service }: { service: string }) => {
        vault.set(service, password);
        return true;
      },
    );
    ({ forgetUnregisteredDevice } = require('../../../pro/sync/forgetUnregisteredDevice'));
    await require('../../../pro/sync/pairingSecretStore').pairingSecretStore.load();
  });

  /** This phone pairs with the desktop and holds a membership for it, as a real pairing leaves it. */
  async function trustDesktop(membershipId: string) {
    const { pairingSecretStore } = require('../../../pro/sync/pairingSecretStore');
    const desktop = {
      id: 'desktop-peer',
      name: 'Desktop',
      platform: 'macos',
      version: '1',
      host: '192.168.1.50',
      port: 7777,
      sharedSecret: 'the-shared-secret',
      membershipId,
      pairedAt: 1_700_000_000_000,
      lastConnected: 1_700_000_000_000,
    } as PairedDevice;
    await pairingSecretStore.beginPairing(desktop);
    await pairingSecretStore.commitPairing(desktop);
  }

  it('retires the membership this device holds for it', async () => {
    await trustDesktop('generation-7');

    await forgetUnregisteredDevice(
      optionsWith(() => owner),
      'desktop-peer',
    );

    expect(forgotten).toEqual([['desktop-peer', 'generation-7']]);
  });

  it('does nothing when this device holds no trust for it', async () => {

    await forgetUnregisteredDevice(
      optionsWith(() => owner),
      'desktop-peer',
    );

    // Nothing to retire is not a failure: the licence has no installation and this device has no
    // membership, so the state being asked for is the state already in place.
    expect(forgotten).toEqual([]);
  });

  it('does nothing when Sync is not running to retire it through', async () => {
    await trustDesktop('generation-7');

    await forgetUnregisteredDevice(
      optionsWith(() => undefined),
      'desktop-peer',
    );

    expect(forgotten).toEqual([]);
  });
});
