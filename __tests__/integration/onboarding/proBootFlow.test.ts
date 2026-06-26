/**
 * Integration: Pro boot flow
 *
 * Verifies checkProStatus runs before loadProFeatures, that Pro features only
 * activate when the keychain holds an active license, and that a background
 * Keygen revalidation updates the cached entitlement after boot.
 */

jest.mock('../../../src/services/keygenClient', () => ({
  validateKey: jest.fn(),
  activateMachine: jest.fn(),
  listMachines: jest.fn(),
  deactivateMachine: jest.fn(),
  KeygenNetworkError: class KeygenNetworkError extends Error {},
}));

jest.mock('../../../src/services/deviceFingerprint', () => ({
  getDeviceFingerprint: jest.fn(async () => 'fp-123'),
  getPlatformTag: jest.fn(() => 'ios'),
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(() => Promise.resolve(true)),
  resetGenericPassword: jest.fn(() => Promise.resolve(true)),
  ACCESSIBLE: { AFTER_FIRST_UNLOCK: 'AfterFirstUnlock' },
}));

jest.mock('../../../src/stores/appStore', () => {
  const setHasRegisteredPro = jest.fn();
  return { useAppStore: { getState: () => ({ setHasRegisteredPro }) } };
});

jest.mock('../../../src/services/tools/extensions', () => ({ registerToolExtension: jest.fn() }));
jest.mock('../../../src/navigation/screenRegistry', () => ({ registerScreen: jest.fn() }));
jest.mock('../../../src/components/settings/sectionRegistry', () => ({ registerSettingsSection: jest.fn() }));
jest.mock('@offgrid/pro', () => ({ activate: jest.fn() }), { virtual: true });

import { checkProStatus } from '../../../src/services/proLicenseService';
import { loadProFeatures } from '../../../src/bootstrap/loadProFeatures';

const { validateKey } = require('../../../src/services/keygenClient');
const Keychain = require('react-native-keychain');
const mockGetGenericPassword = Keychain.getGenericPassword;
const mockSetGenericPassword = Keychain.setGenericPassword;
const mockActivate = require('@offgrid/pro').activate;
const mockSetHasRegisteredPro = require('../../../src/stores/appStore').useAppStore.getState().setHasRegisteredPro;

const VALID = { valid: true, code: 'VALID', license: { id: 'lic-1', expiry: null, metadata: {}, name: null } };

describe('Pro boot flow integration', () => {
  let originalDev: any;
  beforeEach(() => {
    jest.clearAllMocks();
    mockSetGenericPassword.mockResolvedValue(true);
    validateKey.mockResolvedValue(VALID);
    // Test production gating (DEV_UNLOCK_PRO = __DEV__ forces activation in jest).
    originalDev = (global as any).__DEV__;
    (global as any).__DEV__ = false;
  });
  afterEach(() => {
    (global as any).__DEV__ = originalDev;
  });

  it('reads entitlement and skips Pro activation when there is no license', async () => {
    mockGetGenericPassword.mockResolvedValue(false);

    const isPro = await checkProStatus();
    await loadProFeatures(isPro);

    expect(isPro).toBe(false);
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('reads entitlement and activates Pro when a license is cached', async () => {
    mockGetGenericPassword.mockResolvedValue({
      password: JSON.stringify({ isPro: true, key: 'key/abc', licenseId: 'lic-1', expiry: null, verifiedAt: 0 }),
    });

    const isPro = await checkProStatus();
    await loadProFeatures(isPro);

    expect(isPro).toBe(true);
    expect(mockActivate).toHaveBeenCalledWith(
      expect.objectContaining({
        registerToolExtension: expect.any(Function),
        registerScreen: expect.any(Function),
        registerSettingsSection: expect.any(Function),
      }),
    );
  });

  it('background Keygen revalidation updates the cache after boot', async () => {
    // Cached as not-pro but a key is present; revalidation confirms it's VALID.
    mockGetGenericPassword.mockResolvedValue({
      password: JSON.stringify({ isPro: false, key: 'key/abc', licenseId: 'lic-1', expiry: null, verifiedAt: 0 }),
    });

    const isPro = await checkProStatus();
    expect(isPro).toBe(false); // cached value first

    // let the background revalidatePro() settle
    await new Promise((resolve) => setImmediate(resolve));

    expect(validateKey).toHaveBeenCalledWith('key/abc', 'fp-123');
    expect(mockSetGenericPassword).toHaveBeenCalledTimes(1);
    expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
  });
});
