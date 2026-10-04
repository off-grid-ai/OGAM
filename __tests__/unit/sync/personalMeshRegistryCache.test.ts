import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PersonalMeshInstallation } from '@offgrid/sync';
import { personalMeshRegistryCache } from '../../../pro/sync/personalMeshRegistryCache';
import {createLicensedMesh} from '../../harness/licensedMesh';

const STORAGE_KEY = '@offgrid/pro/sync/personal-mesh-registry-v1';

/**
 * The roster the phone remembers when it cannot reach the licence.
 *
 * On a phone this is the normal case, not the edge case - a tunnel, a plane, a dead data plan - so the
 * Devices screen is drawn from here far more often than from a live answer. Two failures matter, and both
 * are silent: a roster that comes back partial hides a device the user owns, and a remembered roster that
 * comes back labelled `fresh` lets stale membership look authoritative enough to evict a real seat.
 *
 * Storage is untrusted input. It survives app upgrades, it is written by an older build than the one
 * reading it, and a user can restore it from a backup - so every shape below is something that can
 * genuinely be on disk, and the only acceptable answer to any of it is "no roster", never a throw and
 * never a half-roster.
 */
describe('the roster the phone remembers', () => {
  const mesh = createLicensedMesh();

  beforeAll(() => mesh.reset());
  afterAll(() => mesh.restore());

  const providerSnapshot = <T extends {
    freshness: 'fresh' | 'cached';
    checkedAt: number;
    installations: readonly PersonalMeshInstallation[];
  }>(value: T) => ({...value, maxDevices: mesh.maxMachines});

  const installation = (
    overrides: Partial<PersonalMeshInstallation> = {},
  ): PersonalMeshInstallation => ({
    installationId: 'install-1',
    syncDeviceId: 'device-1',
    deviceName: 'The Mac',
    platform: 'macos',
    lastActiveAt: 1_700_000_000_000,
    createdAt: 1_600_000_000_000,
    ...overrides,
  });

  const plant = (value: unknown) =>
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(value));

  beforeEach(() => AsyncStorage.removeItem(STORAGE_KEY));

  it('remembers nothing before the licence has ever answered', async () => {
    // Not an empty roster - no roster at all. An empty answer would claim the licence holds no devices,
    // which is a claim a phone that has never reached it is in no position to make.
    await expect(personalMeshRegistryCache.load()).resolves.toBeUndefined();
  });

  it('gives back what the licence last said, marked as remembered rather than current', async () => {
    await personalMeshRegistryCache.save(providerSnapshot({
      freshness: 'fresh',
      checkedAt: 1_700_000_000_000,
      installations: [
        installation(),
        installation({ installationId: 'install-2', platform: 'android' }),
      ],
    }));

    const loaded = await personalMeshRegistryCache.load();

    // `cached`, never `fresh`: what is on disk is by definition an old answer, and the screen decides how
    // much to trust the roster from exactly this field.
    expect(loaded?.freshness).toBe('cached');
    expect(loaded?.checkedAt).toBe(1_700_000_000_000);
    expect(loaded?.maxDevices).toBe(mesh.maxMachines);
    expect(loaded?.installations).toEqual([
      installation(),
      installation({ installationId: 'install-2', platform: 'android' }),
    ]);
  });

  it('remembers an empty roster once the licence has actually said so', async () => {
    await personalMeshRegistryCache.save(providerSnapshot({
      freshness: 'fresh',
      checkedAt: 5,
      installations: [],
    }));

    // Distinct from never having asked: the licence answered, and its answer was none.
    await expect(personalMeshRegistryCache.load()).resolves.toEqual({
      freshness: 'cached',
      checkedAt: 5,
      maxDevices: mesh.maxMachines,
      installations: [],
    });
  });

  it('replaces the whole roster, so a seat given up elsewhere stops being offered', async () => {
    await personalMeshRegistryCache.save(providerSnapshot({
      freshness: 'fresh',
      checkedAt: 1,
      installations: [installation(), installation({ installationId: 'gone' })],
    }));

    await personalMeshRegistryCache.save(providerSnapshot({
      freshness: 'fresh',
      checkedAt: 2,
      installations: [installation()],
    }));

    const loaded = await personalMeshRegistryCache.load();
    expect(
      loaded?.installations.map(({ installationId }) => installationId),
    ).toEqual(['install-1']);
    expect(loaded?.checkedAt).toBe(2);
  });

  it('keeps every device it is told about, including ones on the same platform', async () => {
    await personalMeshRegistryCache.save(providerSnapshot({
      freshness: 'fresh',
      checkedAt: 1,
      installations: [
        installation({ installationId: 'phone-1', platform: 'ios' }),
        installation({ installationId: 'phone-2', platform: 'ios' }),
      ],
    }));

    // Two iPhones are two seats. Anything that collapsed them by platform would under-count the mesh.
    await expect(personalMeshRegistryCache.load()).resolves.toMatchObject({
      installations: [
        { installationId: 'phone-1' },
        { installationId: 'phone-2' },
      ],
    });
  });

  it('says no roster rather than throwing when what is on disk is not JSON at all', async () => {
    await AsyncStorage.setItem(STORAGE_KEY, '{ this was truncated by a crash');

    // A throw here would take the Devices screen down with it, over a cache whose entire job is to be
    // optional.
    await expect(personalMeshRegistryCache.load()).resolves.toBeUndefined();
  });

  it.each([
    ['a bare number', 5],
    ['nothing', null],
    ['an array where an object belongs', []],
  ])('says no roster when the stored value is %s', async (_label, value) => {
    await plant(value);

    await expect(personalMeshRegistryCache.load()).resolves.toBeUndefined();
  });

  it.each([
    [
      'it is already marked as remembered, so a rewrite loop is under way',
      { freshness: 'cached' },
    ],
    ['the roster is missing', { installations: undefined }],
    ['the roster is not a list', { installations: {} }],
    ['there is no time on it', { checkedAt: undefined }],
    ['the time is not a number', { checkedAt: 'yesterday' }],
    ['the time is fractional', { checkedAt: 1.5 }],
    ['the time is before the epoch', { checkedAt: -1 }],
  ])('discards the snapshot when %s', async (_label, overrides) => {
    await plant({
      freshness: 'fresh',
      maxDevices: mesh.maxMachines,
      checkedAt: 10,
      installations: [installation()],
      ...overrides,
    });

    await expect(personalMeshRegistryCache.load()).resolves.toBeUndefined();
  });

  it.each([
    ['no installation id', { installationId: undefined }],
    ['a blank installation id', { installationId: '   ' }],
    ['an installation id that is not text', { installationId: 7 }],
    ['no device id', { syncDeviceId: undefined }],
    ['a blank device id', { syncDeviceId: '' }],
    ['no name', { deviceName: undefined }],
    ['a blank name', { deviceName: ' ' }],
    ['no platform', { platform: undefined }],
    ['a platform this build does not know', { platform: 'watchos' }],
    ['a platform that is not text', { platform: 3 }],
    ['no last-active time', { lastActiveAt: undefined }],
    ['a fractional last-active time', { lastActiveAt: 1.5 }],
    ['a negative last-active time', { lastActiveAt: -1 }],
    ['a last-active time that is not a number', { lastActiveAt: 'now' }],
    ['no created time', { createdAt: undefined }],
    ['a fractional created time', { createdAt: 0.5 }],
    ['a negative created time', { createdAt: -20 }],
    ['a created time that is not a number', { createdAt: null }],
    ['nothing where a device belongs', undefined],
    ['a string where a device belongs', 'the-mac'],
  ])(
    'discards the WHOLE roster when one device has %s',
    async (_label, broken) => {
      await plant({
        freshness: 'fresh',
        maxDevices: mesh.maxMachines,
        checkedAt: 10,
        installations: [
          installation(),
          typeof broken === 'object' && broken !== null
            ? { ...installation(), ...broken }
            : broken,
        ],
      });

      // All-or-nothing on purpose: a roster returned with the good half is a roster the user believes is
      // complete, and a device silently missing from it is a device they cannot reach or revoke.
      await expect(personalMeshRegistryCache.load()).resolves.toBeUndefined();
    },
  );

  it('accepts every platform the mesh actually runs on', async () => {
    const platforms = ['macos', 'windows', 'linux', 'android', 'ios'] as const;
    await personalMeshRegistryCache.save(providerSnapshot({
      freshness: 'fresh',
      checkedAt: 1,
      installations: platforms.map(platform =>
        installation({ installationId: platform, platform }),
      ),
    }));

    const loaded = await personalMeshRegistryCache.load();

    // Read back through the validator: a platform the writer allows but the reader rejects would drop the
    // entire roster the moment one of these devices joined.
    expect(loaded?.installations.map(({ platform }) => platform)).toEqual([
      ...platforms,
    ]);
  });

  it('accepts a device that has only just been created', async () => {
    await personalMeshRegistryCache.save(providerSnapshot({
      freshness: 'fresh',
      checkedAt: 0,
      installations: [installation({ lastActiveAt: 0, createdAt: 0 })],
    }));

    // Zero is a real timestamp, not a missing one. Rejecting it would discard the roster of a device
    // whose clock had not been set yet.
    await expect(personalMeshRegistryCache.load()).resolves.toMatchObject({
      checkedAt: 0,
      installations: [{ lastActiveAt: 0, createdAt: 0 }],
    });
  });

  it('writes the roster as a current answer, so the next launch can tell it is remembered', async () => {
    await personalMeshRegistryCache.save(providerSnapshot({
      freshness: 'cached',
      checkedAt: 42,
      installations: [installation()],
    }));

    const raw = await AsyncStorage.getItem(STORAGE_KEY);

    // Stored as `fresh` whatever it was handed, because the demotion to `cached` belongs to the read.
    // Storing `cached` would make the row unreadable by the loader above - which is what the discard case
    // for an already-remembered snapshot is guarding.
    expect(JSON.parse(raw ?? 'null')).toEqual({
      freshness: 'fresh',
      checkedAt: 42,
      maxDevices: mesh.maxMachines,
      installations: [installation()],
    });
  });
});
