import { useAppStore } from '../../../src/stores/appStore';
import { createKeygenFake } from '../../harness/keygenFake';

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
 * This used to stand in for the app's own store and licence service with hand-written partial objects,
 * and both drifted behind the real modules - the store gained a setter, the service gained a function,
 * and the tests failed for reasons that had nothing to do with booting. Now the store, the licence
 * service, the cache and the registries are real; the keychain, the device fingerprint and Keygen's
 * HTTP endpoint stand in, because those three are the device and the network.
 */

const LICENCE_KEY = 'OFFGRID-TEST-LICENCE';
const FINGERPRINT = 'fp-this-phone';

// The pro package itself, which is what activation switches on. Its own contents are its own tests'
// business; what matters here is that it is handed the registries, and that it is handed the function
// that registers the entitlement provider - without which the app can never read a licence at all.
jest.mock(
  '@offgrid/pro',
  () => {
    const {
      proLicenseProvider,
    } = require('../../../pro/licensing/proLicenseProvider');
    return {
      activate: jest.fn(),
      configureProEntitlementProvider: (
        register: (provider: unknown) => void,
      ) => {
        register(proLicenseProvider);
      },
    };
  },
  { virtual: true },
);

describe('opening the app as a Pro user, and as a free one', () => {
  const keygen = createKeygenFake();
  let vault: Map<string, string>;
  let licenceId = '';
  let activate: jest.Mock;
  let originalDev: unknown;

  /** The app store the launch actually wrote to, which is the reloaded copy rather than this one. */
  const storeState = (): Record<string, unknown> =>
    require('../../../src/stores/appStore').useAppStore.getState();

  /** What the keychain holds, as the next launch would read it. */
  const cached = (): Record<string, unknown> | null => {
    const raw = vault.get('off-grid-pro-license');
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  };

  /**
   * Everything below the app: the keychain, the hardware id and Keygen's endpoint.
   *
   * Bound from the CURRENT module graph, because each launch reloads it - the entitlement lifecycle
   * memoises its one launch-time revalidation, so a second launch in the same graph silently skips the
   * check this suite is about. Reloading means the keychain the code under test sees is a different copy
   * of the module, and it has to be re-wired to the same vault or every cached licence reads as absent.
   */
  function installBoundaries(): void {
    const fingerprint = require('../../../pro/licensing/deviceFingerprint');
    jest
      .spyOn(fingerprint, 'getDeviceFingerprintStrict')
      .mockResolvedValue(FINGERPRINT);
    jest
      .spyOn(fingerprint, 'getDeviceFingerprint')
      .mockResolvedValue(FINGERPRINT);

    const secure = require('react-native-keychain');
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
    useAppStore.getState().setProActive(false);
    useAppStore.getState().setHasRegisteredPro(false);
  });

  afterEach(() => {
    keygen.restore();
    jest.restoreAllMocks();
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
    jest.resetModules();
    installBoundaries();
    activate = require('@offgrid/pro').activate as jest.Mock;
    activate.mockClear();
    const {
      loadProFeatures,
    } = require('../../../src/bootstrap/loadProFeatures');
    return loadProFeatures();
  }

  it('leaves the licensed half switched off for a phone with no licence', async () => {
    const active = await launch();

    expect(active).toBe(false);
    // Not merely hidden: the pro package is never activated, so its screens are not registered and its
    // background work never starts on a device that is not entitled.
    expect(activate).not.toHaveBeenCalled();
    expect(storeState().isProActive).toBe(false);
  });

  it('does not boot Pro from an expired saved credential', async () => {
    const expiry = new Date(Date.now() - 1).toISOString();
    keygen.reset();
    licenceId = keygen.addLicence({
      key: LICENCE_KEY,
      seats: 3,
      expiry,
    });
    vault.set(
      'off-grid-pro-license',
      JSON.stringify({
        isPro: true,
        key: LICENCE_KEY,
        licenseId: licenceId,
        expiry,
        verifiedAt: Date.now() - 10_000,
      }),
    );

    const active = await launch();

    expect(active).toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(storeState()).toMatchObject({
      isProActive: false,
      hasRegisteredPro: false,
      hasSavedProCredential: true,
      hasExpiredProCredential: true,
    });
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
    // The three ways the pro package reaches the user: a tool the chat can call, a screen in the nav,
    // and a section in Settings. Activation hands it all three, so a missing one is a whole surface the
    // user cannot reach with nothing failing anywhere.
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({
        registerToolExtension: expect.any(Function),
        registerScreen: expect.any(Function),
        registerSettingsSection: expect.any(Function),
      }),
    );
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
    expect(activate).toHaveBeenCalled();
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
