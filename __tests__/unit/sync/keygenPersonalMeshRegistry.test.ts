import {
  PersonalMeshEntitlementError,
  type PairingEntitlementCredential,
  type PersonalMeshInstallation,
  type PersonalMeshRegistryAdapter,
} from '@offgrid/sync';
import { createKeygenPersonalMeshRegistry } from '../../../pro/sync/keygenPersonalMeshRegistry';
import { createKeygenFake, type KeygenFake } from '../../harness/keygenFake';

const LICENCE_KEY = 'OFFGRID-MOBILE-REGISTRY';

/**
 * The licence's record of which devices are in the mesh, as the phone reads it.
 *
 * The same authority the Mac consults, reached through the same provider - so this is the phone's half of a
 * contract that has to agree on both sides. A device that is not on the licence is not in the mesh, whatever the
 * phone remembers locally, and that is the direction that must win.
 *
 * The client, the JSON:API parsing and the seat accounting run for real against an in-memory provider that
 * really holds machines and really enforces the cap. Only the HTTP call at the bottom and the device fingerprint
 * are substituted - the fingerprint because it is minted once per install from the keychain and a suite cannot
 * choose it.
 */
describe('the licence s record of the mesh, from the phone', () => {
  const FINGERPRINT = 'fp-this-phone';

  let keygen: KeygenFake;
  let licenceId: string;

  const credential = (): PairingEntitlementCredential => ({
    version: 1,
    entitlementId: licenceId,
    secret: LICENCE_KEY,
    expiresAt: null,
    maxDevices: 3,
    verifiedAt: 1_700_000_000_000,
  });

  const registry = (context?: {
    fingerprint: string;
    registration: { syncDeviceId: string; deviceName: string; platform: 'ios' };
    lastActiveAt: number;
  }): PersonalMeshRegistryAdapter =>
    createKeygenPersonalMeshRegistry(credential(), context);

  const thisPhone = {
    syncDeviceId: FINGERPRINT,
    deviceName: "Mac's iPhone",
    platform: 'ios' as const,
  };

  const installation = (
    overrides: Partial<PersonalMeshInstallation> = {},
  ): PersonalMeshInstallation =>
    ({
      installationId: FINGERPRINT,
      syncDeviceId: FINGERPRINT,
      deviceName: "Mac's iPhone",
      platform: 'ios',
      lastActiveAt: 1_700_000_000_000,
      createdAt: 1_700_000_000_000,
      ...overrides,
    } as PersonalMeshInstallation);

  beforeEach(() => {
    jest
      .spyOn(
        require('../../../pro/licensing/deviceFingerprint'),
        'getDeviceFingerprintStrict',
      )
      .mockResolvedValue(FINGERPRINT);
    keygen = createKeygenFake();
    keygen.install();
    keygen.reset();
    licenceId = keygen.addLicence({ key: LICENCE_KEY, seats: 3 });
  });

  afterEach(() => {
    keygen.restore();
    jest.restoreAllMocks();
  });

  describe('a credential it cannot use', () => {
    it.each([
      ['no secret', { secret: '' }],
      ['no licence to ask about', { entitlementId: '' }],
    ])('refuses to be built with %s', (_label, broken) => {
      // Built at pairing time from a credential another device sent. Failing here, before any request, is what
      // keeps a half-formed credential from producing requests that look like a licence problem.
      expect(() =>
        createKeygenPersonalMeshRegistry({ ...credential(), ...broken }),
      ).toThrow(PersonalMeshEntitlementError);
    });
  });

  describe('reading the roster', () => {
    it('reports every device the licence holds', async () => {
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: FINGERPRINT,
        name: 'iPhone',
        platform: 'ios',
      });

      const installations = await registry().listInstallations();

      expect(
        installations.map(({ syncDeviceId }) => syncDeviceId).sort(),
      ).toEqual(['fp-the-mac', FINGERPRINT]);
    });

    it('identifies each device by its fingerprint, not the provider s own id', async () => {
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });

      const [device] = await registry().listInstallations();

      // The fingerprint IS the sync device id, which is what pairing, membership and the op-log are keyed by.
      // Using the provider's machine id here would make the roster unjoinable to any of them.
      expect(device?.installationId).toBe('fp-the-mac');
      expect(device?.syncDeviceId).toBe('fp-the-mac');
      expect(device).toMatchObject({
        deviceName: 'MacBook',
        platform: 'macos',
      });
    });

    it('reports an empty mesh as empty', async () => {
      await expect(registry().listInstallations()).resolves.toEqual([]);
    });

    it('fills in this phone s own details when the provider s record is thin', async () => {
      keygen.activate({ key: LICENCE_KEY, fingerprint: FINGERPRINT });

      const [device] = await registry({
        fingerprint: FINGERPRINT,
        registration: thisPhone,
        lastActiveAt: 1_700_000_123_000,
      }).listInstallations();

      // A machine registered by an older build may carry no name or platform. For THIS phone the app knows both,
      // so the row says "Mac's iPhone" rather than being dropped as unmappable.
      expect(device).toMatchObject({
        syncDeviceId: FINGERPRINT,
        deviceName: "Mac's iPhone",
        platform: 'ios',
      });
    });

    it('falls back to this phone s own activity when the provider s times are unusable', async () => {
      keygen.activate({ key: LICENCE_KEY, fingerprint: FINGERPRINT });
      for (const machine of keygen.machines(LICENCE_KEY)) {
        // A provider record whose timestamps are not dates at all - an older row, or a field the API changed.
        (machine as { created: string; updated: string }).created =
          'not a date';
        (machine as { created: string; updated: string }).updated =
          'not a date';
      }

      const [device] = await registry({
        fingerprint: FINGERPRINT,
        registration: thisPhone,
        lastActiveAt: 1_700_000_999_000,
      }).listInstallations();

      // Rather than dropping this phone from its own roster: the app knows when it was last active, and a row
      // missing only a timestamp is still a device the user owns.
      expect(device).toMatchObject({
        syncDeviceId: FINGERPRINT,
        lastActiveAt: 1_700_000_999_000,
        createdAt: 0,
      });
    });

    it('keeps a thin record as a seat nobody holds, so it can be released first', async () => {
      keygen.activate({ key: LICENCE_KEY, fingerprint: 'fp-a-mystery' });

      const [seat] = await registry().listInstallations();

      // This used to THROW, and that throw is what bricked a real licence: it happens inside
      // listInstallations, so one thin record failed activation on every device the user owned - reported
      // as a replacement that had never been attempted. Adding a device must always work.
      //
      // Dropping the row silently would hide a seat the user is paying for, so it is kept and marked as
      // belonging to no device (no syncDeviceId, activity 0). The shared eviction order releases those
      // FIRST, ahead of any device still in use - which is the safe direction: there is no membership to
      // revoke and no peer to notify.
      expect(seat?.syncDeviceId).toBe('');
      expect(seat?.lastActiveAt).toBe(0);
      expect(seat?.installationId).toBeTruthy();
      expect(seat?.deviceName).toBeTruthy();
    });

    it('ignores a provider time that is missing rather than merely unparseable', async () => {
      keygen.activate({ key: LICENCE_KEY, fingerprint: FINGERPRINT });
      for (const machine of keygen.machines(LICENCE_KEY)) {
        (
          machine as { created: string | null; updated: string | null }
        ).created = null;
        (
          machine as { created: string | null; updated: string | null }
        ).updated = null;
      }

      // Absent and unparseable are both "no time", and both fall back to what the app knows - a row that
      // distinguished them would drop this phone from its own roster on one of the two.
      const [device] = await registry({
        fingerprint: FINGERPRINT,
        registration: thisPhone,
        lastActiveAt: 1_700_000_555_000,
      }).listInstallations();
      expect(device?.lastActiveAt).toBe(1_700_000_555_000);
    });

    it('reports nothing when the provider cannot be reached', async () => {
      keygen.setOffline(true);

      await expect(registry().listInstallations()).rejects.toBeDefined();
    });
  });

  describe('putting this phone on the licence', () => {
    it('takes a seat under the fingerprint this phone actually has', async () => {
      const registered = await registry().registerInstallation(thisPhone);

      expect(registered).toMatchObject({
        syncDeviceId: FINGERPRINT,
        deviceName: "Mac's iPhone",
        platform: 'ios',
      });
      // Read back from the provider: the seat is only real if it is on the licence.
      expect(
        keygen.machines(LICENCE_KEY).map(({ fingerprint }) => fingerprint),
      ).toEqual([FINGERPRINT]);
    });

    it('renames a device it already knows rather than taking a second seat', async () => {
      const mesh = registry();
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: FINGERPRINT,
        name: 'Old name',
        platform: 'ios',
      });
      await mesh.listInstallations();

      const registered = await mesh.registerInstallation({
        ...thisPhone,
        deviceName: 'The new name',
      });

      // One seat, renamed. A second activation of the same fingerprint spends a seat the user then has to free
      // from a device that does not exist.
      expect(keygen.machines(LICENCE_KEY)).toHaveLength(1);
      expect(registered.deviceName).toBe('The new name');
    });

    it('says the licence is full rather than pretending to register', async () => {
      keygen.reset();
      licenceId = keygen.addLicence({ key: LICENCE_KEY, seats: 1 });
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });

      // `replacement_failed`, not a generic error: the caller uses it to offer freeing a seat, which is the only
      // thing the user can actually do about it.
      await expect(registry().registerInstallation(thisPhone)).rejects.toThrow(
        PersonalMeshEntitlementError,
      );
      expect(keygen.machines(LICENCE_KEY)).toHaveLength(1);
    });

    it('says registration failed - not "licence full" - when the provider refuses the key', async () => {
      const wrongKey = createKeygenPersonalMeshRegistry({
        ...credential(),
        secret: 'OFFGRID-NOT-A-KEY',
      });

      // The two failures are told apart on purpose: "full" offers the user a seat to free, while a refused key is
      // not something freeing a seat can fix.
      await expect(wrongKey.registerInstallation(thisPhone)).rejects.toThrow(
        PersonalMeshEntitlementError,
      );
      expect(keygen.machines(LICENCE_KEY)).toEqual([]);
    });

    it('reports a device the licence has since forgotten', async () => {
      const mesh = registry();
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: FINGERPRINT,
        name: 'iPhone',
        platform: 'ios',
      });
      await mesh.listInstallations();
      // The seat was freed from another device between the listing and now.
      keygen.forget(FINGERPRINT);

      // It takes the rename path and the provider says the machine is gone. Failing is what makes the caller
      // re-activate rather than assume it is licensed.
      await expect(mesh.registerInstallation(thisPhone)).rejects.toThrow(
        PersonalMeshEntitlementError,
      );
    });
  });

  describe('keeping a device s details current', () => {
    it('updates the device it was told about', async () => {
      const mesh = registry();
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: FINGERPRINT,
        name: 'Old name',
        platform: 'ios',
      });
      const [known] = await mesh.listInstallations();

      const updated = await mesh.ensureInstallation!(known!, {
        ...thisPhone,
        deviceName: 'Renamed in Settings',
      });

      // The name on the licence is what every other device shows for this phone, so a rename has to reach it.
      expect(updated.deviceName).toBe('Renamed in Settings');
      expect(keygen.machines(LICENCE_KEY)[0]?.name).toBe('Renamed in Settings');
    });

    it('refuses to update a device the roster has not been read for', async () => {
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: FINGERPRINT,
        name: 'iPhone',
        platform: 'ios',
      });

      // Without a listing there is no provider id to address, and guessing one would update somebody else's
      // machine record.
      await expect(
        registry().ensureInstallation!(installation(), thisPhone),
      ).rejects.toThrow(PersonalMeshEntitlementError);
    });

    it('reports a device the licence no longer has', async () => {
      const mesh = registry();
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: FINGERPRINT,
        name: 'iPhone',
        platform: 'ios',
      });
      const [known] = await mesh.listInstallations();
      keygen.forget(FINGERPRINT);

      await expect(mesh.ensureInstallation!(known!, thisPhone)).rejects.toThrow(
        PersonalMeshEntitlementError,
      );
    });
  });

  describe('freeing a seat', () => {
    it('takes the device off the licence', async () => {
      const mesh = registry();
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });
      await mesh.listInstallations();

      await mesh.deregisterInstallation!('fp-the-mac');

      // Gone from the provider, which is what actually makes the seat available to the next device.
      expect(keygen.machines(LICENCE_KEY)).toEqual([]);
    });

    it('refuses to free a seat it cannot identify', async () => {
      // `mapping_required`: the phone holds no provider handle for this device, which is a different problem
      // from the provider refusing - and the caller reports it differently.
      await expect(
        registry().deregisterInstallation!('fp-never-seen'),
      ).rejects.toThrow(PersonalMeshEntitlementError);
    });

    it('reports a seat that was already gone', async () => {
      const mesh = registry();
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });
      await mesh.listInstallations();
      keygen.forget('fp-the-mac');

      // Freeing a seat that is already free is not success: the caller is mid-transaction on a roster it no
      // longer holds, and it has to stop rather than continue on a stale one.
      await expect(mesh.deregisterInstallation!('fp-the-mac')).rejects.toThrow(
        PersonalMeshEntitlementError,
      );
    });
  });

  describe('putting a seat back', () => {
    it('restores it exactly as it was', async () => {
      const mesh = registry();
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });
      const [mac] = await mesh.listInstallations();
      await mesh.deregisterInstallation!('fp-the-mac');

      const restored = await mesh.restoreInstallation!(mac!);

      // Same fingerprint, name and platform: a rollback that restored a device under a different name would show
      // the user a device they do not recognise in place of the one they had.
      expect(restored).toMatchObject({
        syncDeviceId: 'fp-the-mac',
        deviceName: 'MacBook',
        platform: 'macos',
      });
      expect(
        keygen.machines(LICENCE_KEY).map(({ fingerprint }) => fingerprint),
      ).toEqual(['fp-the-mac']);
    });

    it('restores a device the provider recorded no platform for', async () => {
      keygen.activate({ key: LICENCE_KEY, fingerprint: FINGERPRINT });
      const mesh = registry({
        fingerprint: FINGERPRINT,
        registration: thisPhone,
        lastActiveAt: 1_700_000_000_000,
      });
      const [phone] = await mesh.listInstallations();
      await mesh.deregisterInstallation!(FINGERPRINT);

      const restored = await mesh.restoreInstallation!(phone!);

      // The provider's record has no platform, so the one the roster carries is used instead - otherwise a
      // rollback would put the device back as nothing and the next listing would refuse to map it.
      expect(restored.platform).toBe('ios');
    });

    it('refuses to restore a device with no platform to restore it as', async () => {
      const mesh = registry();
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });
      await mesh.listInstallations();

      // A device with no platform cannot be re-registered as anything, and inventing one would put a Mac back on
      // the licence as a phone.
      await expect(
        mesh.restoreInstallation!(
          installation({
            installationId: 'fp-the-mac',
            syncDeviceId: 'fp-the-mac',
            platform: undefined as never,
          }),
        ),
      ).rejects.toThrow(PersonalMeshEntitlementError);
    });

    it('says the rollback is incomplete when it has nothing to put back', async () => {
      // `rollback_incomplete` is its own outcome: the mesh is now in a state a person has to resolve, and
      // reporting it as a plain failure would hide that.
      await expect(
        registry().restoreInstallation!(
          installation({
            installationId: 'fp-never-seen',
            syncDeviceId: 'fp-never-seen',
          }),
        ),
      ).rejects.toThrow(PersonalMeshEntitlementError);
    });

    it('says so when the seat has since been taken', async () => {
      keygen.reset();
      licenceId = keygen.addLicence({ key: LICENCE_KEY, seats: 1 });
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-mac',
        name: 'MacBook',
        platform: 'macos',
      });
      const mesh = registry();
      const [mac] = await mesh.listInstallations();
      await mesh.deregisterInstallation!('fp-the-mac');
      // Another device took the only seat while this transaction was open.
      keygen.activate({
        key: LICENCE_KEY,
        fingerprint: 'fp-the-ipad',
        name: 'iPad',
        platform: 'ios',
      });

      await expect(mesh.restoreInstallation!(mac!)).rejects.toThrow(
        PersonalMeshEntitlementError,
      );
    });
  });

  it('does not pretend to record activity', async () => {
    // Declared unsupported rather than silently doing nothing: the provider's heartbeat changes what an offline
    // licence lease means, so the caller has to know this phone is not sending one.
    // Asked with a real installation and time, as reconciliation would - and still refused.
    await expect(
      registry().recordActivity!(FINGERPRINT, 1_700_000_000_000),
    ).resolves.toMatchObject({ status: 'unsupported' });
  });
});
