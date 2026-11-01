import type { PairedDevice } from '@offgrid/sync';
import { repairDevice } from '../../../pro/sync/repairDevice';
import { pairingSecretStore } from '../../../pro/sync/pairingSecretStore';
import { resetKeychain } from '../../harness/keyedRemoteServer';

// The phone's keychain: it really stores the pairing trust the store writes and reads back.
jest.mock('react-native-keychain', () => require('../../harness/deviceKeychain').deviceKeychainModule());

/**
 * Repairing a device the peer did not recognise, without demanding the code first.
 *
 * The user proved they had the code once. A peer that restarted, or whose pairing store had not finished
 * loading when we called, needs nothing more than another handshake - so asking for the code again is the
 * LAST resort, not the first move. Getting this backwards is the "why is repair asking for a pairing
 * code" complaint: the credential was sitting there the whole time.
 *
 * Three outcomes, and the difference between the last two is the point: no credential means the code is
 * genuinely required, while a credential the peer refuses means we tried and the code is required anyway.
 *
 * repairDevice and the real pairing store run; the credential is written by pairing (begin + commit).
 */
describe('repairing a device that was not recognised', () => {
  const desktop: PairedDevice = {
    id: 'desktop-peer', name: 'Off Grid AI Desktop', platform: 'macos', version: '1',
    host: '192.168.1.20', port: 7878, sharedSecret: 'a-shared-secret', membershipId: 'generation-1', pairedAt: 1,
  };

  beforeEach(async () => {
    resetKeychain();
    pairingSecretStore.resetCache();
    await pairingSecretStore.load();
  });

  /** The user paired with the desktop once, entering the code. */
  async function pairedEarlier() {
    await pairingSecretStore.beginPairing(desktop);
    await pairingSecretStore.commitPairing(desktop);
    expect(pairingSecretStore.get('desktop-peer')).toBe('a-shared-secret');
  }

  it('reconnects with the credential it already holds', async () => {
    await pairedEarlier();
    const dialled: string[] = [];

    const outcome = await repairDevice('desktop-peer', async deviceId => {
      dialled.push(deviceId);
    });

    expect(outcome).toBe('reconnected');
    expect(dialled).toEqual(['desktop-peer']);
  });

  it('asks for the code when it holds no credential, without dialling', async () => {
    expect(pairingSecretStore.get('desktop-peer')).toBeUndefined();
    const dialled: string[] = [];

    const outcome = await repairDevice('desktop-peer', async deviceId => {
      dialled.push(deviceId);
    });

    expect(outcome).toBe('needs_code');
    // Not dialled at all: a fresh install has nothing to prove possession with, so a handshake would only
    // fail slowly on its way to the same answer.
    expect(dialled).toEqual([]);
  });

  it('asks for the code after trying, when the peer refuses what it holds', async () => {
    await pairedEarlier();
    const dialled: string[] = [];

    const outcome = await repairDevice('desktop-peer', async deviceId => {
      dialled.push(deviceId);
      throw new Error('the other device did not recognise this one');
    });

    // Same answer as having no credential, reached the other way round - and only after the cheap attempt
    // that would have spared the user typing anything.
    expect(dialled).toEqual(['desktop-peer']);
    expect(outcome).toBe('needs_code');
  });

  it('treats a non-Error rejection as a refusal too', async () => {
    await pairedEarlier();

    const outcome = await repairDevice('desktop-peer', async () => {
      // A native module can reject with a string. Repair still has to reach a decision.
      return Promise.reject('socket closed');
    });

    expect(outcome).toBe('needs_code');
  });
});
