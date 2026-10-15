/**
 * Every feature is free.
 *
 * SPEC (OGAM user's view): nobody pays, and nobody is asked to. A phone that has never held a licence, one
 * whose licence lapsed, and one the licensed-device roster has dropped all get the same app: the optional
 * pro bundle is loaded and switched on for each of them, and no screen offers a price, a key, or a way in.
 *
 * This replaces the suite that asserted the opposite - "leaves the licensed half switched off for a phone
 * with no licence" - because that was the paid contract, and the paid contract is gone. What has to hold
 * now is that access is not a function of the two facts it used to be a function of: whether a credential
 * exists, and what the roster last said about this device.
 *
 * The bundle itself is mocked (a licence-free build still has to load whatever IS in the build), and
 * everything under it - the store, the entitlement service, the registries - is real.
 */
import {
  createProAccessSlice,
  selectHasProAccess,
  type ProAccessSlice,
} from '../../../src/stores/proAccessSlice';

const mockActivate = jest.fn();
const mockConfigureProvider = jest.fn();
const mockActivateSyncBootstrap = jest.fn();

jest.mock(
  '@offgrid/pro',
  () => ({
    activate: (...args: unknown[]) => mockActivate(...args),
    activateSyncBootstrap: (...args: unknown[]) =>
      mockActivateSyncBootstrap(...args),
    configureProEntitlementProvider: (...args: unknown[]) =>
      mockConfigureProvider(...args),
  }),
  { virtual: true },
);

import { loadProFeatures } from '../../../src/bootstrap/loadProFeatures';
import { useAppStore } from '../../../src/stores/appStore';

/** A store slice in the given state, built through the real factory so the shape cannot drift. */
function sliceWith(overrides: Partial<ProAccessSlice> = {}): ProAccessSlice {
  return { ...createProAccessSlice(() => undefined), ...overrides };
}

describe('the pro bundle switched on without a purchase', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // The store is real and persists: put the licence projection back so later cases start from nothing.
    useAppStore.setState({
      hasRegisteredPro: false,
      hasSavedProCredential: false,
      isProActive: false,
      hasExpiredProCredential: false,
      proDeviceAdmission: 'unknown',
    });
  });

  it('activates the bundle on an install that has never held a licence', async () => {
    // Nothing bought, nothing cached: the projection stays empty...
    expect(useAppStore.getState().hasRegisteredPro).toBe(false);

    const loaded = await loadProFeatures();

    // ...and the features load anyway, because activation is handed the registries that mount them.
    expect(loaded).toBe(true);
    expect(mockConfigureProvider).toHaveBeenCalledTimes(1);
    expect(mockActivate).toHaveBeenCalledTimes(1);
    expect(mockActivate).toHaveBeenCalledWith(
      expect.objectContaining({
        registerScreen: expect.any(Function),
        registerSlot: expect.any(Function),
        registerHook: expect.any(Function),
        registerSettingsSection: expect.any(Function),
        registerToolExtension: expect.any(Function),
      }),
    );
    expect(selectHasProAccess(useAppStore.getState())).toBe(true);
  });

  it('registers the Sync bootstrap even before anything is activated', async () => {
    await loadProFeatures();

    expect(mockActivateSyncBootstrap).toHaveBeenCalledTimes(1);
    expect(mockActivateSyncBootstrap).toHaveBeenCalledWith(
      expect.objectContaining({
        registerScreen: expect.any(Function),
        registerSlot: expect.any(Function),
        registerHook: expect.any(Function),
      }),
    );
  });

  it('activates the bundle for a dropped device holding an expired credential', async () => {
    // The two facts the old rule refused on, at once: a credential that has lapsed, and a roster that
    // says this phone is not on the licence. Free means free, so the bundle loads for it too.
    useAppStore.setState({
      hasRegisteredPro: true,
      hasSavedProCredential: true,
      isProActive: false,
      hasExpiredProCredential: true,
      proDeviceAdmission: 'inactive',
    });

    const loaded = await loadProFeatures();

    expect(loaded).toBe(true);
    expect(mockActivate).toHaveBeenCalledTimes(1);
  });
});

describe('access is not a function of a credential or a device roster', () => {
  it('grants a device that holds nothing, with a roster that has said nothing', () => {
    expect(selectHasProAccess(sliceWith())).toBe(true);
  });

  it('grants a device whose saved credential reached its deadline', () => {
    expect(
      selectHasProAccess(
        sliceWith({
          hasRegisteredPro: true,
          hasSavedProCredential: true,
          isProActive: false,
          hasExpiredProCredential: true,
        }),
      ),
    ).toBe(true);
  });

  it('grants a device the licensed-device roster removed', () => {
    // This is the case the old rule existed to catch, and the case it refused: a phone taken off the
    // roster lost every paid surface. Free means free, so it keeps them.
    expect(
      selectHasProAccess(
        sliceWith({
          hasRegisteredPro: true,
          hasSavedProCredential: true,
          isProActive: true,
          proDeviceAdmission: 'inactive',
        }),
      ),
    ).toBe(true);
  });

  it('grants a device on a roster that has not answered yet', () => {
    expect(
      selectHasProAccess(
        sliceWith({
          hasRegisteredPro: true,
          hasSavedProCredential: true,
          isProActive: true,
          proDeviceAdmission: 'unknown',
        }),
      ),
    ).toBe(true);
  });
});
