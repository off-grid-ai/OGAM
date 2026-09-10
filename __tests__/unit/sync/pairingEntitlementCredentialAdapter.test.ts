import {
  PersonalMeshEntitlementError,
  type PairingEntitlementCredential,
  type PersonalMeshReconciliationSnapshot,
  type PersonalMeshRegistrationInput,
  type ProDeviceAdmission,
} from '@offgrid/sync';
import { createPairingEntitlementHostAdapter } from '../../../pro/sync/pairingEntitlementCredentialAdapter';
import { mobileEntitlementCredentialStore } from '../../../pro/licensing/mobileEntitlementCredentialStore';
import { pairingSecretStore } from '../../../pro/sync/pairingSecretStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createKeygenFake, type KeygenFake } from '../../harness/keygenFake';

/**
 * Two of the user's devices agreeing about the licence they share.
 *
 * Pairing is not only a trust exchange - it is a licence transaction. One device already holds the licence
 * and sponsors the other onto it; the other takes the credential, registers itself as a seat, and becomes
 * Pro. Either half can fail, and the shape of the failure is what the user lives with:
 *
 *  - Half-committed the wrong way and the user pays for a seat held by a device that is not paired.
 *  - Rolled back badly and a phone that was Pro on its OWN licence comes back free after a failed pairing
 *    with somebody else's - the user loses something they bought by trying to pair.
 *  - Registered without a seat and the licence quietly holds more devices than it sells.
 *
 * So every step here is prepare / commit / finalize with a rollback, and this suite is about what is true
 * after each of those, including after the ones that fail.
 *
 * The keychain and Keygen's HTTP endpoint stand in. The credential store, the trust store, the mesh
 * coordinators, the registry, the seat accounting and the reconciliation are all real.
 */
describe('two devices agreeing about a shared licence', () => {
  const DEFAULT_MAX_DEVICES = 3;
  const FULL_MESH_MAX_DEVICES = 5;
  const LICENCE_KEY = 'OFFGRID-TEST-LICENCE';
  const OTHER_LICENCE_KEY = 'OFFGRID-OTHER-LICENCE';
  /** This phone's hardware identity, which is also its seat's identity on the licence. */
  const FINGERPRINT = 'fp-this-phone';

  let keygen: KeygenFake;
  let licenceId = '';
  let vault: Map<string, string>;
  let registryChanges: number;
  let admissions: ProDeviceAdmission[];
  let snapshots: PersonalMeshReconciliationSnapshot[];
  let forgotten: Array<[string, string]>;
  let syncIsRunning: boolean;

  const thisPhone: PersonalMeshRegistrationInput = {
    syncDeviceId: FINGERPRINT,
    deviceName: "Mac's iPhone",
    platform: 'ios',
  };

  const theMac: PersonalMeshRegistrationInput = {
    syncDeviceId: 'fp-the-mac',
    deviceName: "Mac's MacBook Pro",
    platform: 'macos',
  };

  const keychain = (): {
    getGenericPassword: jest.Mock;
    setGenericPassword: jest.Mock;
    resetGenericPassword: jest.Mock;
  } => require('react-native-keychain');

  function host(): ReturnType<typeof createPairingEntitlementHostAdapter> {
    return createPairingEntitlementHostAdapter({
      localDevice: thisPhone,
      membershipOwner: () =>
        syncIsRunning
          ? {
              // Standing in for the Sync runtime, and doing what it really does: retiring a membership
              // begins the bilateral revocation, which takes the device OUT of the trusted list. Recording
              // the call without that would leave a trusted row behind and make a second pass retire the
              // same device again - a difference this suite would otherwise never see.
              forget: async (deviceId: string, membershipId: string) => {
                forgotten.push([deviceId, membershipId]);
                const active = pairingSecretStore.getActive(deviceId);
                if (!active) return;
                await pairingSecretStore.beginLocal(active, {
                  device: {
                    id: active.id,
                    name: active.name,
                    platform: active.platform,
                    version: active.version,
                    host: active.host,
                    port: active.port,
                  },
                  membershipId,
                  revocationId: `revocation-for-${deviceId}`,
                  revocationSecret: `revocation-secret-${deviceId}`,
                  requestedAt: 1_700_000_090_000,
                });
              },
            }
          : null,
      onReconciliationChanged: snapshot => snapshots.push(snapshot),
      onLocalAdmissionChanged: admission => admissions.push(admission),
      onRegistryChanged: () => {
        registryChanges += 1;
      },
    });
  }

  /**
   * The code a transaction refused with, which is what the far device is told and what the pairing screen
   * turns into a sentence. Asserting the reason and not the message keeps this about the decision.
   */
  async function refusalReason(act: () => Promise<unknown>): Promise<string> {
    try {
      await act();
    } catch (error) {
      expect(error).toBeInstanceOf(PersonalMeshEntitlementError);
      return (error as PersonalMeshEntitlementError).code;
    }
    throw new Error('the transaction was expected to refuse, and did not');
  }

  /** The credential a licensed peer hands over inside the pairing channel. */
  function credentialFrom(
    key: string,
    entitlementId: string,
    maxDevices = DEFAULT_MAX_DEVICES,
  ): PairingEntitlementCredential {
    return {
      version: 1,
      entitlementId,
      secret: key,
      expiresAt: null,
      maxDevices,
      verifiedAt: 1_700_000_000_000,
    };
  }

  const FULL_LICENCE_KEY = 'OFFGRID-FULL';

  /**
   * A mesh already holding every device it admits.
   *
   * Worth stating which limit this is: the number of devices in the mesh is capped by the PRODUCT, not by
   * the seat count on the licence. A licence sold with one seat does not make the mesh full - the cap does.
   * The two are checked in different places and a test that confuses them passes for the wrong reason.
   */
  async function meshIsFull(): Promise<void> {
    const fullLicenceId = keygen.addLicence({
      key: FULL_LICENCE_KEY,
      seats: FULL_MESH_MAX_DEVICES + 2,
    });
    // Activated first, so it is the one that has been on the licence - and away - longest.
    keygen.activate({
      key: FULL_LICENCE_KEY,
      fingerprint: 'fp-away-longest',
      name: 'Old MacBook',
      platform: 'macos',
    });
    for (let index = 1; index < FULL_MESH_MAX_DEVICES; index += 1) {
      keygen.activate({
        key: FULL_LICENCE_KEY,
        fingerprint: `fp-device-${index}`,
        name: `Device ${index}`,
        platform: 'macos',
      });
    }
    await mobileEntitlementCredentialStore.write({
      isPro: true,
      key: FULL_LICENCE_KEY,
      entitlementId: fullLicenceId,
      expiry: null,
      maxMachines: FULL_MESH_MAX_DEVICES,
      tier: null,
      verifiedAt: 1_700_000_000_000,
    });
  }

  const fingerprintsOnFullLicence = (): string[] =>
    keygen.machines(FULL_LICENCE_KEY).map(machine => machine.fingerprint);

  /**
   * A device already holding a place on this phone's licence.
   *
   * The name and the platform are not decoration: an installation missing either is refused as unusable
   * identity metadata, and the whole roster is then rejected rather than partly believed. So the fake
   * supplies them exactly as the provider does.
   */
  function onLicence(
    fingerprint: string,
    name: string,
    platform: 'ios' | 'macos' = 'macos',
    key: string = LICENCE_KEY,
  ): void {
    keygen.activate({ key, fingerprint, name, platform });
  }

  /** A device this phone has paired with, as the trust store holds it. */
  async function trust(deviceId: string, membershipId?: string): Promise<void> {
    const device = {
      id: deviceId,
      name: deviceId === 'fp-the-mac' ? "Mac's MacBook Pro" : 'Another Device',
      platform: 'macos' as const,
      version: '1',
      host: '192.168.1.50',
      port: 7777,
      sharedSecret: `secret-for-${deviceId}`,
      membershipId,
      pairedAt: 1_700_000_000_000,
      lastConnected: 1_700_000_000_000,
    };
    await pairingSecretStore.beginPairing(device as never);
    await pairingSecretStore.commitPairing(device as never);
    await pairingSecretStore.flush();
  }

  /** This phone holding the licence itself, which is what lets it sponsor another device. */
  async function thisPhoneIsLicensed(): Promise<void> {
    await mobileEntitlementCredentialStore.write({
      isPro: true,
      key: LICENCE_KEY,
      entitlementId: licenceId,
      expiry: null,
      maxMachines: DEFAULT_MAX_DEVICES,
      tier: null,
      verifiedAt: 1_700_000_000_000,
    });
  }

  beforeEach(async () => {
    jest
      .spyOn(
        require('../../../pro/licensing/deviceFingerprint'),
        'getDeviceFingerprintStrict',
      )
      .mockResolvedValue(FINGERPRINT);

    vault = new Map<string, string>();
    const secure = keychain();
    secure.getGenericPassword.mockImplementation(
      async ({ service }: { service: string }) => {
        const value = vault.get(service);
        return value ? { username: 'stored', password: value } : false;
      },
    );
    secure.setGenericPassword.mockImplementation(
      async (
        _user: string,
        password: string,
        { service }: { service: string },
      ) => {
        vault.set(service, password);
        return true;
      },
    );
    secure.resetGenericPassword?.mockImplementation?.(
      async ({ service }: { service: string }) => vault.delete(service),
    );

    keygen = createKeygenFake();
    keygen.install();
    keygen.reset();
    licenceId = keygen.addLicence({ key: LICENCE_KEY, seats: 3 });

    pairingSecretStore.resetCache();
    await pairingSecretStore.load();
    await AsyncStorage.clear();
    registryChanges = 0;
    admissions = [];
    snapshots = [];
    forgotten = [];
    syncIsRunning = true;
  });

  afterEach(() => {
    keygen.restore();
    jest.restoreAllMocks();
  });

  describe("sponsoring another device onto this phone's licence", () => {
    it('hands over the credential that lets the other device register itself', async () => {
      await thisPhoneIsLicensed();
      const adapter = host();

      const prepared = await adapter.prepareExport(theMac);

      // The sponsoring device makes ROOM; it does not register the peer. Registration is the peer's own act,
      // using this credential, because a seat has to be tied to the hardware identity of the device holding
      // it - and only that device can prove what its identity is.
      expect(prepared.credential).toMatchObject({
        version: 1,
        entitlementId: licenceId,
        secret: LICENCE_KEY,
      });
      expect(keygen.machines(LICENCE_KEY)).toEqual([]);

      await adapter.commitExport(prepared.id);
      await adapter.finalizeExport(prepared.id);

      // Nothing was consumed: the licence had room, so making room took nothing away.
      expect(keygen.machines(LICENCE_KEY)).toEqual([]);
      // The Devices screen reads the roster, so it is told to look again.
      expect(registryChanges).toBe(1);
    });

    it('frees room by evicting the device that has been away longest', async () => {
      // A mesh already holding as many devices as it admits. Pairing another has to be possible, and the only
      // way is for this phone - which holds the licence - to give one of those places up.
      await meshIsFull();
      const adapter = host();

      const prepared = await adapter.prepareExport(theMac);

      // The place goes at PREPARE, not at commit, and that is the right way round: the peer registers itself
      // with this credential, so the room has to exist before it tries. The one that went is the device that
      // has been away longest, which is the only choice a person would accept without being asked.
      expect(fingerprintsOnFullLicence()).not.toContain('fp-away-longest');
      expect(fingerprintsOnFullLicence()).toHaveLength(
        FULL_MESH_MAX_DEVICES - 1,
      );

      await adapter.commitExport(prepared.id);
      await adapter.finalizeExport(prepared.id);

      // Committing and finalizing make it permanent - they retire this device's local trust in the evicted
      // device - and take nothing further off the licence.
      expect(fingerprintsOnFullLicence()).toHaveLength(
        FULL_MESH_MAX_DEVICES - 1,
      );
    });

    it('puts a replaced device back when the pairing then fails', async () => {
      await meshIsFull();
      const adapter = host();
      const prepared = await adapter.prepareExport(theMac);
      expect(fingerprintsOnFullLicence()).not.toContain('fp-away-longest');

      await adapter.rollbackExport(prepared.id);

      // The pairing failed after the place was given up, so the device evicted for it is put back. Left as
      // it was, the user would have lost a device and gained nothing for it.
      expect(fingerprintsOnFullLicence()).toContain('fp-away-longest');
      expect(fingerprintsOnFullLicence()).toHaveLength(FULL_MESH_MAX_DEVICES);
    });

    it('refuses when this phone has no licence to share', async () => {
      const adapter = host();

      // Not 'registration_failed': nothing was attempted. The pairing screen tells the user neither device is
      // licensed, which is a thing they can act on by buying or entering a key.
      expect(await refusalReason(() => adapter.prepareExport(theMac))).toBe('neither_licensed');
    });

    it('gives the seat back when the pairing falls apart after preparing', async () => {
      await thisPhoneIsLicensed();
      const adapter = host();
      const prepared = await adapter.prepareExport(theMac);

      await adapter.rollbackExport(prepared.id);

      expect(keygen.machines(LICENCE_KEY)).toEqual([]);
      // The transaction is forgotten, so a duplicate rollback - a retry, a late error arriving after the
      // first one - cannot undo something a LATER pairing did.
      await expect(adapter.rollbackExport(prepared.id)).resolves.toBeUndefined();
      expect(await refusalReason(() => adapter.commitExport(prepared.id))).toBe('replacement_failed');
    });

    it('ignores a rollback for a pairing it never prepared', async () => {
      // Rollback is the path taken when something already went wrong, so it cannot be the thing that throws.
      await expect(
        host().rollbackExport('a-transaction-that-never-was'),
      ).resolves.toBeUndefined();
    });

    it.each([
      ['committing', (adapter: ReturnType<typeof host>) => adapter.commitExport('nope')],
      ['finalizing', (adapter: ReturnType<typeof host>) => adapter.finalizeExport('nope')],
    ])('refuses %s a pairing it never prepared', async (_label, act) => {
      await thisPhoneIsLicensed();

      // Committing an unknown transaction would mean acting on state this device does not have. Refusing is
      // what stops a replayed or out-of-order message changing the licence.
      expect(await refusalReason(() => act(host()))).toBe('replacement_failed');
    });
  });

  describe("joining another device's licence", () => {
    it('registers this phone and turns Pro on, in that order', async () => {
      const adapter = host();
      const credential = credentialFrom(LICENCE_KEY, licenceId);

      const prepared = await adapter.prepareImport(credential, thisPhone);

      // Prepared, not committed: the credential is not in the keychain yet, so a pairing that dies here
      // leaves the phone exactly as free as it was.
      await expect(
        mobileEntitlementCredentialStore.read(),
      ).resolves.toMatchObject({ isPro: false, key: null });

      await adapter.commitImport(prepared.id);

      await expect(
        mobileEntitlementCredentialStore.read(),
      ).resolves.toMatchObject({
        isPro: true,
        key: LICENCE_KEY,
        entitlementId: licenceId,
      });

      await adapter.finalizeImport(prepared.id);

      expect(
        keygen.machines(LICENCE_KEY).map(machine => machine.fingerprint),
      ).toEqual([FINGERPRINT]);
      expect(registryChanges).toBe(1);
    });

    it('refuses a credential for a licence the key does not open', async () => {
      const otherLicenceId = keygen.addLicence({
        key: OTHER_LICENCE_KEY,
        seats: 3,
      });
      const adapter = host();

      // The secret and the licence id travel together and are checked against each other. A credential
      // carrying one device's key and another's licence id is either a mistake or an attempt to be admitted
      // to a licence whose key the sender does not have.
      expect(await refusalReason(() => adapter.prepareImport( credentialFrom(LICENCE_KEY, otherLicenceId), thisPhone, ),)).toBe('registration_failed');
      expect(keygen.machines(OTHER_LICENCE_KEY)).toEqual([]);
    });

    it('refuses a credential whose key the provider does not know', async () => {
      expect(await refusalReason(() => host().prepareImport( credentialFrom('OFFGRID-NOT-A-LICENCE', licenceId), thisPhone, ),)).toBe('registration_failed');
    });

    it.each([
      ['committing', (adapter: ReturnType<typeof host>) => adapter.commitImport('nope')],
      ['finalizing', (adapter: ReturnType<typeof host>) => adapter.finalizeImport('nope')],
    ])('refuses %s a join it never prepared', async (_label, act) => {
      expect(await refusalReason(() => act(host()))).toBe('registration_failed');
    });

    it('ignores a rollback for a join it never prepared', async () => {
      await expect(
        host().rollbackImport('a-transaction-that-never-was'),
      ).resolves.toBeUndefined();
    });

    it('leaves a phone that was free still free when the join is rolled back', async () => {
      const adapter = host();
      const prepared = await adapter.prepareImport(
        credentialFrom(LICENCE_KEY, licenceId),
        thisPhone,
      );
      await adapter.commitImport(prepared.id);

      await adapter.rollbackImport(prepared.id);

      // Cleared, not written back as an empty record: an empty credential in the keychain and no credential
      // at all mean the same thing to every reader, and the store is where that is decided.
      await expect(
        mobileEntitlementCredentialStore.read(),
      ).resolves.toMatchObject({ isPro: false, key: null });
      expect(keygen.machines(LICENCE_KEY)).toEqual([]);
    });

    it('gives a phone that was already licensed its OWN licence back', async () => {
      // The case worth writing a test for: this phone is Pro on its own licence, tries to pair with a Mac
      // on a DIFFERENT licence, and the pairing fails. Losing what the user already paid for by trying to
      // pair would be the worst outcome in this file.
      const otherLicenceId = keygen.addLicence({
        key: OTHER_LICENCE_KEY,
        seats: 3,
      });
      await thisPhoneIsLicensed();
      const adapter = host();

      const prepared = await adapter.prepareImport(
        credentialFrom(OTHER_LICENCE_KEY, otherLicenceId),
        thisPhone,
      );
      await adapter.commitImport(prepared.id);
      await expect(
        mobileEntitlementCredentialStore.read(),
      ).resolves.toMatchObject({ key: OTHER_LICENCE_KEY });

      await adapter.rollbackImport(prepared.id);

      await expect(
        mobileEntitlementCredentialStore.read(),
      ).resolves.toMatchObject({
        isPro: true,
        key: LICENCE_KEY,
        entitlementId: licenceId,
      });
    });

    it('says so when it cannot even put the old credential back', async () => {
      await thisPhoneIsLicensed();
      const otherLicenceId = keygen.addLicence({
        key: OTHER_LICENCE_KEY,
        seats: 3,
      });
      const adapter = host();
      const prepared = await adapter.prepareImport(
        credentialFrom(OTHER_LICENCE_KEY, otherLicenceId),
        thisPhone,
      );
      await adapter.commitImport(prepared.id);

      // The keychain stops accepting writes - the device was locked, or protected storage became
      // unavailable - so the licence this phone already had cannot be written back.
      keychain().setGenericPassword.mockRejectedValue(
        new Error('User interaction is not allowed.'),
      );

      // Reported, because this is the one failure the user would otherwise discover as "my Pro went away
      // after I tried to pair" with nothing in the app admitting it.
      expect(await refusalReason(() => adapter.rollbackImport(prepared.id))).toBe(
        'rollback_incomplete',
      );
    });

    it('says so when the rollback could not put everything back', async () => {
      const adapter = host();
      const prepared = await adapter.prepareImport(
        credentialFrom(LICENCE_KEY, licenceId),
        thisPhone,
      );
      await adapter.commitImport(prepared.id);

      // The network goes away between committing and rolling back, so the seat cannot be released.
      keygen.setOffline(true);

      // Reported rather than swallowed: a seat that could not be released is a seat the user is paying for,
      // and the only way it gets cleaned up is if somebody is told it is outstanding.
      expect(await refusalReason(() => adapter.rollbackImport(prepared.id))).toBe('rollback_incomplete');
      keygen.setOffline(false);
    });
  });

  describe('checking the licence still agrees with what this phone believes', () => {
    it('asks for a credential before it asks the provider anything', async () => {
      const adapter = host();

      const snapshot = await adapter.reconcile('launch');

      // No credential is not an error to show the user as a licence problem - it is a phone that is simply
      // not Pro. Something has to be done, and what has to be done is entering a key or pairing.
      expect(snapshot?.state).toBe('action_required');
      expect(adapter.reconciliationSnapshot()?.state).toBe('action_required');
      expect(admissions).toEqual(['unknown']);
    });

    it('reads the roster and confirms this phone is on it', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();
      const adapter = host();

      const snapshot = await adapter.reconcile('launch');

      expect(snapshot).toMatchObject({ state: 'ready', installations: 1 });
      // Pro stays on because the provider says this seat exists, not because the keychain says so. The
      // keychain is what this device remembers; the roster is what is true.
      expect(admissions).toEqual(['active']);
      // The Devices screen renders from the published snapshot, so it is published and not merely returned -
      // a screen that is already open has to change without being reopened.
      expect(snapshots.at(-1)).toEqual(snapshot);
    });

    it('turns Pro off when the licence no longer holds a seat for this phone', async () => {
      // The seat was evicted from another device. This phone still has a perfectly valid-looking credential
      // in its keychain, and is no longer entitled to anything.
      onLicence('fp-the-mac', "Mac's MacBook Pro");
      await thisPhoneIsLicensed();
      const adapter = host();

      await adapter.reconcile('launch');

      expect(admissions).toEqual(['inactive']);
    });

    it('retires trust in a device the licence has dropped', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();
      await trust('fp-the-mac', 'membership-1');
      const adapter = host();

      await adapter.reconcile('foreground');

      // The Mac was evicted elsewhere, so the membership this phone holds for it is retired. Left in place,
      // the phone would keep trying to talk to a device that is no longer part of the mesh.
      expect(forgotten).toEqual([['fp-the-mac', 'membership-1']]);
    });

    it('leaves a device the licence still holds alone', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      onLicence('fp-the-mac', "Mac's MacBook Pro");
      await thisPhoneIsLicensed();
      await trust('fp-the-mac', 'membership-1');
      const adapter = host();

      await adapter.reconcile('foreground');

      expect(forgotten).toEqual([]);
    });

    it('finishes an eviction that was interrupted by the app being killed', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();
      await trust('fp-the-mac', 'membership-1');
      // Committed on disk and not yet finalized: the seat is already gone from the licence and the local
      // trust is not yet retired. The app was killed in between.
      const replacementId = await pairingSecretStore.prepareCapacityReplacement({
        installationId: 'fp-the-mac',
        syncDeviceId: 'fp-the-mac',
        deviceName: "Mac's MacBook Pro",
        platform: 'macos',
        lastActiveAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
      });
      await pairingSecretStore.commitCapacityReplacement(replacementId);
      const adapter = host();

      await adapter.reconcile('launch');

      // Picked up on the next launch rather than left half done. An eviction stuck half way is a device the
      // user cannot get rid of and cannot use.
      expect(forgotten).toEqual([['fp-the-mac', 'membership-1']]);
      expect(pairingSecretStore.listCapacityReplacements()).toEqual([]);
    });

    it('cannot finish that eviction while Sync is not running, and says so', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();
      // The trust has to exist when the replacement is prepared, because that is where the membership it
      // will retire comes from. A replacement with no membership has nothing to finalize and needs no Sync.
      await trust('fp-the-mac', 'membership-1');
      const replacementId = await pairingSecretStore.prepareCapacityReplacement({
        installationId: 'fp-the-mac',
        syncDeviceId: 'fp-the-mac',
        deviceName: "Mac's MacBook Pro",
        platform: 'macos',
        lastActiveAt: 1_700_000_000_000,
        createdAt: 1_700_000_000_000,
      });
      await pairingSecretStore.commitCapacityReplacement(replacementId);
      syncIsRunning = false;
      const adapter = host();

      const snapshot = await adapter.reconcile('launch');

      // Retiring a membership goes through Sync, so there is nothing to retire it through. Reconciliation
      // does not fail over it - it reports that something is outstanding and leaves the replacement
      // committed, so the next launch picks it up rather than marking it done with nothing done.
      expect(snapshot).toMatchObject({
        state: 'action_required',
        issue: 'replacement_incomplete',
      });
      expect(pairingSecretStore.listCapacityReplacements()).toHaveLength(1);
      expect(forgotten).toEqual([]);
    });

    it('reports being offline rather than guessing, and keeps the last roster', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();
      const adapter = host();
      await adapter.reconcile('launch');

      keygen.setOffline(true);
      const snapshot = await adapter.reconcile('foreground');
      keygen.setOffline(false);

      // A phone on a train is not a phone that lost its licence. The roster it last saw is explicitly stale,
      // never treated as an answer, and Pro is not revoked on the strength of a failed request.
      expect(snapshot?.state).toBe('offline');
      expect(admissions).toEqual(['active', 'active']);
    });

    it('will not talk to the provider if the credential goes while it is asking', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();
      const adapter = host();
      // Pro was turned off in Settings, or the credential expired, between the check that chose to ask and
      // the request itself. The roster is read with the credential, so there is nothing to read it with.
      let reads = 0;
      const secure = keychain();
      const stored = secure.getGenericPassword.getMockImplementation()!;
      secure.getGenericPassword.mockImplementation(
        async (options: { service: string }) => {
          reads += 1;
          if (options.service === 'off-grid-pro-license' && reads > 1) return false;
          return stored(options);
        },
      );

      const snapshot = await adapter.reconcile('launch');

      // Not a crash and not a guess: reconciliation comes back saying something needs doing, and Pro is
      // withdrawn because there is no longer a credential saying otherwise. The roster was never asked for.
      expect(snapshot?.state).toBe('action_required');
      expect(admissions.at(-1)).toBe('unknown');
    });
  });

  describe('the user removing one of their own devices', () => {
    it('takes it off the licence and gives up the trust held for it', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      onLicence('fp-the-mac', "Mac's MacBook Pro");
      await thisPhoneIsLicensed();
      await trust('fp-the-mac', 'membership-1');
      const adapter = host();

      await adapter.evictDevice('fp-the-mac');

      // Both halves, in one action: the seat the user is paying for is released AND the trust is dropped.
      // Either one alone leaves the user with a device they cannot use and cannot get rid of.
      expect(
        keygen.machines(LICENCE_KEY).map(machine => machine.fingerprint),
      ).toEqual([FINGERPRINT]);
      expect(forgotten).toEqual([['fp-the-mac', 'membership-1']]);
      expect(registryChanges).toBeGreaterThan(0);
    });

    it('removes a leftover row for a device the licence knows nothing about', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();
      await trust('fp-reinstalled-phone', 'membership-9');
      const adapter = host();

      await adapter.evictDevice('fp-reinstalled-phone');

      // A phone that was reinstalled comes back under a new identity, so its old installation can never be
      // matched again. Without this the row could only ever fail to be removed, and the user would be left
      // looking at a device they cannot delete.
      expect(forgotten).toEqual([['fp-reinstalled-phone', 'membership-9']]);
    });

    it('refuses when this phone has no credential to remove it with', async () => {
      expect(await refusalReason(() => host().evictDevice('fp-the-mac'))).toBe(
        'secure_storage_unavailable',
      );
    });

    it('refuses while Sync is not running to give up the trust through', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      onLicence('fp-the-mac', "Mac's MacBook Pro");
      await thisPhoneIsLicensed();
      await trust('fp-the-mac', 'membership-1');
      syncIsRunning = false;

      // Better to refuse than to release the seat and leave the trust behind: that pair is what a device
      // being "removed" means, and half of it is a device that is neither there nor gone.
      await expect(host().evictDevice('fp-the-mac')).rejects.toThrow(
        'Sync is not ready to finalize mesh replacement.',
      );
    });
  });

  describe('a mesh with no room left', () => {
    it('tells the joining device its peer has to make room first', async () => {
      await meshIsFull();
      const fullLicenceId = (await mobileEntitlementCredentialStore.read())
        .entitlementId!;
      // This phone is the one being sponsored, so it holds no licence of its own.
      await mobileEntitlementCredentialStore.clear();

      // A device being sponsored cannot evict anything. It does not hold the licence and has no business
      // deciding which of the user's other devices loses its place - that choice belongs to the device that
      // owns the licence, and this refusal says so in as many words rather than failing as a licence error.
      let message = '';
      try {
        await host().prepareImport(
          credentialFrom(FULL_LICENCE_KEY, fullLicenceId, FULL_MESH_MAX_DEVICES),
          thisPhone,
        );
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toBe(
        'The licensed peer must prepare capacity before this device can register.',
      );
      // Nothing was taken from anyone to make the attempt.
      expect(fingerprintsOnFullLicence()).toHaveLength(FULL_MESH_MAX_DEVICES);
    });

    it('refuses when the licence itself has no seat left to sell', async () => {
      const soldOutId = keygen.addLicence({ key: 'OFFGRID-SOLD-OUT', seats: 1 });
      keygen.activate({
        key: 'OFFGRID-SOLD-OUT',
        fingerprint: 'fp-someone-else',
        name: 'Another Mac',
        platform: 'macos',
      });

      // A different limit from the mesh cap: this one is the provider's, reached first on a one-seat licence,
      // and it refuses with 'replacement_failed' rather than 'mapping_required'. Both end the same way for
      // the user - this device cannot join - which is exactly why it is worth a test that says which limit
      // was hit, because the two are fixed in different places.
      expect(
        await refusalReason(() =>
          host().prepareImport(
            credentialFrom('OFFGRID-SOLD-OUT', soldOutId),
            thisPhone,
          ),
        ),
      ).toBe('replacement_failed');
    });
  });

  describe('what this phone claims about its licence', () => {
    it('claims a licence only when the provider holds a place for it', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();

      // What the other device is shown during pairing, and what decides which of the two sponsors the other.
      await expect(host().inspect()).resolves.toEqual({
        status: 'licensed',
        entitlementId: licenceId,
      });
    });

    it('claims nothing when the credential names a place the provider does not hold', async () => {
      // A perfectly valid-looking credential in the keychain for a seat that has since been evicted from
      // another device. Claiming a licence on the strength of it would let this phone sponsor a device onto a
      // licence it is no longer part of.
      await thisPhoneIsLicensed();

      await expect(host().inspect()).resolves.toEqual({ status: 'unlicensed' });
    });

    it('claims nothing when it holds no credential', async () => {
      // Answered without a request: there is nothing to ask the provider about, and a phone with no
      // credential must not stall pairing behind a network call.
      await expect(host().inspect()).resolves.toEqual({ status: 'unlicensed' });
    });
  });

  describe('trust rows reconciliation cannot act on', () => {
    it('leaves a trusted row whose credential is gone, rather than failing over it', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();
      // A trust row with no secret: the keychain entry survived and the credential in it did not, which the
      // trust document deliberately admits rather than dropping the device from the user's list.
      vault.set(
        'off-grid-sync-pairings',
        JSON.stringify({
          version: 6,
          pairings: {
            'fp-the-mac': {
              device: {
                id: 'fp-the-mac',
                name: "Mac's MacBook Pro",
                platform: 'macos',
                version: '1',
                host: '192.168.1.50',
                port: 7777,
              },
              membershipId: 'membership-1',
              pairedAt: 1_700_000_000_000,
              lastSeenAt: 1_700_000_000_000,
              state: 'trusted',
            },
          },
        }),
      );
      pairingSecretStore.resetCache();
      await pairingSecretStore.load();
      const adapter = host();

      const snapshot = await adapter.reconcile('foreground');

      // There is no membership to retire through, so retiring is skipped and reconciliation still comes back
      // ready. Treating it as a failure would leave the user staring at a warning about a row they can
      // already see and remove themselves.
      expect(forgotten).toEqual([]);
      expect(snapshot?.state).toBe('ready');
    });

    it('reports being unable to retire a device paired before memberships existed', async () => {
      onLicence(FINGERPRINT, "Mac's iPhone", 'ios');
      await thisPhoneIsLicensed();
      await trust('fp-the-mac');
      const adapter = host();

      const snapshot = await adapter.reconcile('foreground');

      // The device is off the licence and this phone has trust for it but no membership to revoke, so the
      // bilateral revocation cannot be started. Surfaced rather than swallowed: the row needs a person.
      expect(snapshot).toMatchObject({
        state: 'action_required',
        issue: 'replacement_incomplete',
      });
      expect(forgotten).toEqual([]);
    });
  });
});
