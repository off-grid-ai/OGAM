import { createKeygenFake } from '../../harness/keygenFake';
import { installNativeBoundary } from '../../harness/nativeBoundary';

// The sync mesh's native transports, which a Pro launch brings up: the device boundary.
jest.mock('react-native-tcp-socket', () => {
  const { createNativeTcpBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeTcpBoundary() };
});
jest.mock('react-native-zeroconf', () => {
  const { createNativeDiscoveryBoundary } = require('../../utils/nativeSyncBoundaries');
  return { __esModule: true, default: createNativeDiscoveryBoundary() };
});

/**
 * Opening the app as a Pro user, and as a free one.
 *
 * Two facts are established in the first moments of a launch: whether this phone is entitled, and -
 * only if it is - the licensed half of the app being switched on. Getting either wrong is immediately
 * visible: a paying user greeted by the upgrade prompt, or a free build with pro screens in the nav.
 *
 * The entitlement is read from the keychain, and the launch awaits ONE check against the provider before
 * anything is drawn - so a stale cache is corrected without the user seeing a flash of the wrong screen,
 * and a provider that cannot be reached falls back to the cached answer rather than to nothing.
 *
 * This used to stand in for the app's own store, licence service and pro package with hand-written
 * partial objects, and they drifted behind the real modules. Now the store, the licence service, the
 * cache, the registries and the pro package itself are real; the keychain (which also holds this
 * install's device fingerprint, saved by an earlier launch), the native modules, the sync transports
 * and Keygen's HTTP endpoint stand in, because those are the device and the network. What the pro
 * package switched on is read off the registries and stores it writes to.
 */

const LICENCE_KEY = 'OFFGRID-TEST-LICENCE';

/** Wait for a condition the launch reaches in the background. */
async function waitUntil(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition never became true');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
const FINGERPRINT = 'fp-this-phone';

describe('opening the app as a Pro user, and as a free one', () => {
  const keygen = createKeygenFake();
  let vault: Map<string, string>;
  let licenceId = '';
  let originalDev: unknown;

  /** The app store the launch actually wrote to, which is the reloaded copy rather than this one. */
  const storeState = (): Record<string, unknown> =>
    require('../../../src/stores/appStore').useAppStore.getState();

  /** What the keychain holds, as the next launch would read it. */
  const cached = (): Record<string, unknown> | null => {
    const raw = vault.get('off-grid-pro-license');
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  };

  /** What the pro package switched on: the tools the chat can call and the screens in the nav. */
  const proSurfaces = () => ({
    tools: require('../../../src/services/tools/extensions').getToolExtensions().length,
    screens: require('../../../src/navigation/screenRegistry').getRegisteredScreens()
      .map((screen: { name: string }) => screen.name),
  });

  /** Whether licence activation was readied: the sync host published this phone's device. */
  const activationReadied = (): boolean =>
    require('../../../pro/sync/syncStore').useSyncStore.getState().thisDevice != null;

  /**
   * Everything below the app: the native modules, the keychain and Keygen's endpoint.
   *
   * Bound from the CURRENT module graph, because each launch reloads it - the entitlement lifecycle
   * memoises its one launch-time revalidation, so a second launch in the same graph silently skips the
   * check this suite is about. Reloading means the keychain the code under test sees is a different copy
   * of the module, and it has to be re-wired to the same vault or every cached licence reads as absent.
   */
  function installBoundaries(): void {
    installNativeBoundary();
    // This install's fingerprint, saved in the keychain by an earlier launch.
    vault.set('off-grid-device-fingerprint', FINGERPRINT);

    const secure = require('react-native-keychain');
    secure.getGenericPassword.mockImplementation(
      async ({ service }: { service: string }) => {
        const value = vault.get(service);
        return value ? { username: 'stored', password: value } : false;
      },
    );
    secure.setGenericPassword.mockImplementation(
      async (_user: string, password: string, { service }: { service: string }) => {
        vault.set(service, password);
        return true;
      },
    );
    secure.resetGenericPassword?.mockImplementation?.(
      async ({ service }: { service: string }) => vault.delete(service),
    );
  }

  beforeEach(() => {
    vault = new Map<string, string>();
    keygen.reset();
    keygen.install();
    licenceId = keygen.addLicence({ key: LICENCE_KEY, seats: 3 });

    // Pro is force-unlocked in development, which would activate regardless of the entitlement. These
    // tests are about the SHIPPED gating, so the flag is the one a release build has.
    originalDev = (global as { __DEV__?: unknown }).__DEV__;
    (global as { __DEV__?: unknown }).__DEV__ = false;
  });

  afterEach(async () => {
    // Close the launch: switch the pro package off and stop the sync runtime it started.
    await require('../../../pro').deactivate().catch(() => undefined);
    await require('../../../pro/sync/syncService').syncService.stop().catch(() => undefined);
    keygen.restore();
    (global as { __DEV__?: unknown }).__DEV__ = originalDev;
  });

  /**
   * A launch, exactly as App.tsx does it: ONE call, with no entitlement passed in.
   *
   * This used to call checkProStatus() first and pass the answer along. The app does not - and cannot:
   * the entitlement provider is registered BY this call, so anything read before it comes back false
   * from the stand-in provider and would be passed in as a definite "not Pro", overriding the real
   * cached licence.
   */
  async function launch(): Promise<boolean> {
    installBoundaries();
    const { loadProFeatures } = require('../../../src/bootstrap/loadProFeatures');
    return loadProFeatures();
  }

  it('leaves the licensed half switched off for a phone with no licence', async () => {
    const active = await launch();

    expect(active).toBe(false);
    // Not merely hidden: the paid half of the pro package is never activated, so its tools and screens
    // are not registered and its background work never starts on a device that is not entitled. Sync
    // stays reachable on purpose (claiming a seat goes through the mesh), so only its screens are there.
    const surfaces = proSurfaces();
    expect(surfaces.tools).toBe(0);
    expect(surfaces.screens).not.toContain('McpServers');
    expect(surfaces.screens).toContain('Sync');
    expect(storeState().isProActive).toBe(false);
  });

  it('does not boot Pro from an expired saved credential', async () => {
    vault.set(
      'off-grid-pro-license',
      JSON.stringify({
        isPro: true,
        key: LICENCE_KEY,
        licenseId: licenceId,
        expiry: new Date(Date.now() - 1).toISOString(),
        verifiedAt: Date.now() - 10_000,
      }),
    );

    const active = await launch();

    expect(active).toBe(false);
    expect(proSurfaces().tools).toBe(0);
    expect(storeState()).toMatchObject({
      isProActive: false,
      hasRegisteredPro: false,
      hasSavedProCredential: true,
      hasExpiredProCredential: true,
    });
  });

  it('keeps Sync off on an expired credential, but readies activation for a renewed key', async () => {
    vault.set(
      'off-grid-pro-license',
      JSON.stringify({
        isPro: true,
        key: LICENCE_KEY,
        licenseId: licenceId,
        expiry: new Date(Date.now() - 1).toISOString(),
        verifiedAt: Date.now() - 10_000,
      }),
    );

    await launch();

    // Sync's screens were never registered...
    expect(proSurfaces().screens).not.toContain('Sync');
    // ...but activation was readied. Without this, Activate on the Pro screen waited 30 s and said
    // activation was not ready.
    await waitUntil(activationReadied);
  });

  it('readies activation on a phone with no licence through the Sync bootstrap, not the expired-key path', async () => {
    await launch();
    // A phone with no licence (not an expired one) keeps Sync reachable: its bootstrap is what readies
    // activation, so claiming a seat by key or from a paired device works without the expired-key path.
    expect(proSurfaces().screens).toContain('Sync');
    await waitUntil(activationReadied);
    expect(storeState().hasExpiredProCredential).toBe(false);
  });

  it('switches the licensed half on for a phone that already holds one', async () => {
    // A Pro phone holds a seat on the licence as well as a key in its keychain. Without the seat the
    // launch-time check correctly withdraws Pro - a key that no longer has a device registered against
    // it is not an entitlement, however valid the key itself is.
    keygen.activate({
      key: LICENCE_KEY,
      fingerprint: FINGERPRINT,
      name: 'iPhone',
      platform: 'ios',
    });
    vault.set(
      'off-grid-pro-license',
      JSON.stringify({
        isPro: true,
        key: LICENCE_KEY,
        licenseId: licenceId,
        expiry: null,
        verifiedAt: Date.now(),
      }),
    );

    const active = await launch();

    expect(active).toBe(true);
    // The ways the pro package reaches the user: tools the chat can call and screens in the nav. A
    // missing one is a whole surface the user cannot reach with nothing failing anywhere.
    const surfaces = proSurfaces();
    expect(surfaces.tools).toBeGreaterThan(0);
    expect(surfaces.screens).toEqual(expect.arrayContaining(['McpServers', 'Sync']));
  });

  it('answers from the keychain first, without waiting for the network', async () => {
    keygen.setOffline(true);
    vault.set(
      'off-grid-pro-license',
      JSON.stringify({
        isPro: true,
        key: LICENCE_KEY,
        licenseId: licenceId,
        expiry: null,
        verifiedAt: Date.now(),
      }),
    );

    const active = await launch();

    // A phone on a plane is still a phone the user paid for. Waiting on the provider would leave the
    // app deciding what to draw against a request that will time out.
    expect(active).toBe(true);
    expect(proSurfaces().screens).toContain('McpServers');
    keygen.setOffline(false);
  });

  it('corrects a stale cached answer in the background', async () => {
    // Cached as not entitled while a key is present - the state after a launch that could not reach the
    // provider, or an activation that was interrupted.
    keygen.activate({
      key: LICENCE_KEY,
      fingerprint: FINGERPRINT,
      name: 'iPhone',
      platform: 'ios',
    });
    vault.set(
      'off-grid-pro-license',
      JSON.stringify({
        isPro: false,
        key: LICENCE_KEY,
        licenseId: licenceId,
        expiry: null,
        verifiedAt: 0,
      }),
    );

    const active = await launch();

    // Corrected BEFORE the first screen is drawn, not afterwards: the launch awaits one revalidation, so
    // a user whose licence is perfectly fine never sees a flash of the upgrade prompt. The old version of
    // this test expected the opposite and waited for a background pass that had already happened.
    expect(active).toBe(true);
    expect(cached()).toMatchObject({ isPro: true, key: LICENCE_KEY });
    expect(storeState().hasRegisteredPro).toBe(true);
  });

  it('does not go on believing a licence the provider has stopped honouring', async () => {
    vault.set(
      'off-grid-pro-license',
      JSON.stringify({
        isPro: true,
        key: 'OFFGRID-A-LICENCE-THAT-WAS-REVOKED',
        licenseId: licenceId,
        expiry: null,
        verifiedAt: 0,
      }),
    );

    const active = await launch();

    // A refund, an expiry, a key entered on too many devices. The cached answer got the user in once -
    // it must not get them in for ever, and the correction lands on this launch rather than the next.
    expect(active).toBe(false);
    expect(cached()).toMatchObject({ isPro: false });
    expect(storeState().isProActive).toBe(false);
  });

  it('keeps believing a cached licence when the provider cannot be reached', async () => {
    keygen.setOffline(true);
    vault.set(
      'off-grid-pro-license',
      JSON.stringify({
        isPro: true,
        key: LICENCE_KEY,
        licenseId: licenceId,
        expiry: null,
        verifiedAt: 0,
      }),
    );

    const active = await launch();
    keygen.setOffline(false);

    // The difference that matters: a failed REQUEST is not a refused licence. Treating the two the same
    // would take Pro away from anybody who opened the app on a train.
    expect(active).toBe(true);
    expect(cached()).toMatchObject({ isPro: true });
  });
});
