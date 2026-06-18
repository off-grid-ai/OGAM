/**
 * Integration: Pro boot flow
 *
 * Verifies that configureRevenueCat + checkProStatus run before loadProFeatures,
 * and that Pro features only activate when the keychain entitlement is set.
 */

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    setLogLevel: jest.fn(),
    configure: jest.fn(),
    getCustomerInfo: jest.fn().mockResolvedValue({ entitlements: { active: {} }, originalAppUserId: 'anon', allPurchaseDates: {} }),
    invalidateCustomerInfoCache: jest.fn().mockResolvedValue(undefined),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    restorePurchases: jest.fn(),
    logOut: jest.fn(),
  },
  LOG_LEVEL: { DEBUG: 'debug', ERROR: 'error' },
}));

jest.mock('react-native-keychain', () => ({
  getGenericPassword: jest.fn(),
  setGenericPassword: jest.fn(),
  resetGenericPassword: jest.fn(),
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

import { configureRevenueCat, checkProStatus } from '../../../src/services/proLicenseService';
import { loadProFeatures } from '../../../src/bootstrap/loadProFeatures';

const Purchases = require('react-native-purchases').default;
const Keychain = require('react-native-keychain');
const mockConfigure = Purchases.configure;
const mockGetCustomerInfo = Purchases.getCustomerInfo;
const mockGetGenericPassword = Keychain.getGenericPassword;
const mockSetGenericPassword = Keychain.setGenericPassword;
const mockActivate = require('@offgrid/pro').activate;
const mockSetHasRegisteredPro = require('../../../src/stores/appStore').useAppStore.getState().setHasRegisteredPro;

describe('Pro boot flow integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('configures RevenueCat, reads entitlement, and skips Pro activation when not subscribed', async () => {
    mockGetGenericPassword.mockResolvedValue(false);
    mockGetCustomerInfo.mockResolvedValue({ entitlements: { active: {} } });

    configureRevenueCat();
    await checkProStatus();
    await loadProFeatures();

    expect(mockConfigure).toHaveBeenCalledTimes(1);
    expect(mockActivate).not.toHaveBeenCalled();
  });

  it('configures RevenueCat, reads entitlement, and activates Pro when subscribed', async () => {
    const license = JSON.stringify({ isPro: true, verifiedAt: 0 });
    mockGetGenericPassword.mockResolvedValue({ password: license });
    mockGetCustomerInfo.mockResolvedValue({
      entitlements: { active: { pro: { productIdentifier: 'offgrid_pro' } } },
    });

    configureRevenueCat();
    await checkProStatus();
    await loadProFeatures();

    expect(mockConfigure).toHaveBeenCalledTimes(1);
    expect(mockActivate).toHaveBeenCalledWith(
      expect.objectContaining({
        registerToolExtension: expect.any(Function),
        registerScreen: expect.any(Function),
        registerSettingsSection: expect.any(Function),
      }),
    );
  });

  it('background RC sync writes updated entitlement to store after boot', async () => {
    // Keychain is empty but RC says the user is subscribed (e.g. new device install)
    mockGetGenericPassword
      .mockResolvedValueOnce(false)  // first read in checkProStatus (returns cached false)
      .mockResolvedValue({ password: JSON.stringify({ isPro: true, verifiedAt: 1 }) });
    mockGetCustomerInfo.mockResolvedValue({
      entitlements: { active: { pro: { productIdentifier: 'offgrid_pro' } } },
    });
    mockSetGenericPassword.mockResolvedValue(true);

    configureRevenueCat();
    const isPro = await checkProStatus();

    // Cached value from empty keychain is false; background sync fires async
    expect(isPro).toBe(false);

    // Allow the background syncWithRevenueCat to complete
    await new Promise(resolve => setImmediate(resolve));

    expect(mockSetGenericPassword).toHaveBeenCalledTimes(1);
    expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
  });
});
