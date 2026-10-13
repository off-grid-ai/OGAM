import * as Keychain from 'react-native-keychain';
import { createKeygenFake } from '../../harness/keygenFake';

/**
 * Activating a key on a licence that is already full.
 *
 * A user with five devices buying a sixth must not be told to go and free a seat by hand - the oldest is
 * retired for them. "Oldest" means least recently active, so the phone they used this morning is never the
 * one dropped.
 *
 * This test used to model the flow the app had when it was written: list the machines, DELETE the least
 * recent, POST the new one, all against a hand-written fetch matcher. Two things had moved since. The choice
 * now belongs to PersonalMeshRegistrationCoordinator - and, the actual reason it was failing,
 * activateProByKey delegates to a REGISTERED entitlement provider whose default answers
 * { ok: false, reason: 'registration_failed' } to everything. Nothing had registered one, so the test never
 * reached Keygen and its "registration failed" was the fallback talking rather than a licence being refused.
 *
 * It now registers the real provider the way loadProFeatures does, and stands Keygen up as a fake at the HTTP
 * boundary: real licences and machines, the seat cap enforced, Keygen's own JSON:API shapes. Everything above
 * that is the app - the client, the credential store, the mesh registry, the coordinator.
 */

const keygen = createKeygenFake();
const LICENCE_KEY = 'OFFGRID-FULL-LICENCE';
const CAP = 5;

// The pro package as the app loads it. Its only job here is to hand the licence provider over to be
// registered; nothing else about pro is involved in activating a key.
jest.mock(
  '@offgrid/pro',
  () => {
    const { proLicenseProvider } = require('../../../pro/licensing/proLicenseProvider');
    return {
      activate: jest.fn(),
      configureProEntitlementProvider: (register: (provider: unknown) => void) => {
        register(proLicenseProvider);
      },
    };
  },
  { virtual: true },
);

describe('activating a key when every seat is taken', () => {
  const vault = new Map<string, string>();

  beforeEach(() => {
    vault.clear();
    vault.set('off-grid-device-fingerprint', 'fp-sixth-device');
    keygen.reset();
    keygen.install();

    (Keychain.getGenericPassword as jest.Mock).mockImplementation(
      async ({ service }: { service: string }) => {
        const value = vault.get(service);
        return value ? { username: 'stored', password: value } : false;
      },
    );
    (Keychain.setGenericPassword as jest.Mock).mockImplementation(
      async (_username: string, password: string, { service }: { service: string }) => {
        vault.set(service, password);
        return true;
      },
    );
    (
      Keychain.resetGenericPassword as jest.Mock | undefined
    )?.mockImplementation?.(async ({ service }: { service: string }) => vault.delete(service));
  });

  afterEach(() => {
    keygen.restore();
  });

  /** Fill the licence. Activation order IS recency: the fake stamps each machine later than the last. */
  const fillEverySeat = (): string[] => {
    const fingerprints = [
      'fp-away-longest',
      'fp-second',
      'fp-third',
      'fp-fourth',
      'fp-most-recent',
    ];
    keygen.addLicence({ key: LICENCE_KEY, seats: CAP });
    for (const fingerprint of fingerprints) {
      keygen.activate({ key: LICENCE_KEY, fingerprint, platform: 'ios' });
    }
    return fingerprints;
  };

  const activateWith = async (key: string): Promise<{ ok: boolean; reason?: string }> => {
     
    const service = require('../../../src/services/proLicenseService');
    require('@offgrid/pro').configureProEntitlementProvider(
      service.registerProEntitlementProvider,
    );

    // Register the same entitlement host that syncService prepares before the slower transport startup.
    // The adapter is real. Only its UI callbacks are dropped because no screen is mounted.
    const {
      createPairingEntitlementHostAdapter,
    } = require('../../../pro/sync/pairingEntitlementCredentialAdapter');
    const {
      setDirectEntitlementActivationOwner,
    } = require('../../../pro/licensing/proLicenseProvider');
    const unset = setDirectEntitlementActivationOwner(
      createPairingEntitlementHostAdapter({
        localDevice: {
          syncDeviceId: 'sixth-device',
          deviceName: 'The new phone',
          platform: 'ios',
        },
        membershipOwner: () => undefined,
        onReconciliationChanged: () => undefined,
        onLocalAdmissionChanged: () => undefined,
        onRegistryChanged: async () => undefined,
      }),
    );
     
    try {
      return await service.activateProByKey(key);
    } finally {
      unset();
    }
  };

  const heldFingerprints = (): string[] =>
    keygen.machines(LICENCE_KEY).map(({ fingerprint }) => fingerprint);

  it('takes a free seat before the full sync runtime starts', async () => {
    keygen.addLicence({ key: LICENCE_KEY, seats: CAP });
    keygen.activate({ key: LICENCE_KEY, fingerprint: 'fp-away-longest', platform: 'ios' });

    await expect(activateWith(LICENCE_KEY)).resolves.toMatchObject({ ok: true });

    // Nothing displaced: there was room, so the existing device is untouched.
    expect(heldFingerprints()).toContain('fp-away-longest');
    expect(heldFingerprints()).toContain('fp-sixth-device');
  });

  /**
   * The sixth device on a full licence. The device being replaced was never paired with this phone, so there
   * is no local membership to retire and no live sync runtime is needed: only the seat is released.
   */
  it('retires the device that has been away longest, and admits this one', async () => {
    const fingerprints = fillEverySeat();
    expect(keygen.machines(LICENCE_KEY)).toHaveLength(CAP);

    await expect(activateWith(LICENCE_KEY)).resolves.toMatchObject({ ok: true });

    // In, still exactly at the cap, and the seat that was freed belonged to the device nobody had used for
    // longest.
    expect(heldFingerprints()).toContain('fp-sixth-device');
    expect(heldFingerprints()).toHaveLength(CAP);
    expect(heldFingerprints()).not.toContain(fingerprints[0]);
  });

  it('refuses without displacing anybody when the key is not a licence', async () => {
    fillEverySeat();

    const result = await activateWith('OFFGRID-NOT-A-REAL-KEY');

    // A typo must cost nothing. Freeing a seat before knowing the key is good would retire a real device on
    // behalf of an activation that was never going to happen.
    expect(result.ok).toBe(false);
    expect(keygen.machines(LICENCE_KEY)).toHaveLength(CAP);
  });

  it('blames the network, not the licence, when Keygen cannot be reached', async () => {
    fillEverySeat();
    keygen.setOffline(true);

    const result = await activateWith(LICENCE_KEY);

    // Offline is not "your licence is invalid". Saying the wrong one sends the user to support about a
    // licence that is perfectly fine, and nothing may be displaced on the way.
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('network_unavailable');
    expect(keygen.machines(LICENCE_KEY)).toHaveLength(CAP);
  });
});
