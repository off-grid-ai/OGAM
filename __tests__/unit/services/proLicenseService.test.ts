import {
  readProFromKeychain,
  checkProStatus,
  presentProPaywall,
  restorePro,
  clearProForTesting,
  configureRevenueCat,
} from '../../../src/services/proLicenseService';

jest.mock('react-native-purchases', () => ({
  __esModule: true,
  default: {
    setLogLevel: jest.fn(),
    configure: jest.fn(),
    getCustomerInfo: jest.fn().mockResolvedValue({ entitlements: { active: {} }, originalAppUserId: 'anon', allPurchaseDates: {} }),
    restorePurchases: jest.fn(),
    getOfferings: jest.fn(),
    purchasePackage: jest.fn(),
    invalidateCustomerInfoCache: jest.fn().mockResolvedValue(undefined),
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

const mockSetHasRegisteredPro = jest.fn();
jest.mock('../../../src/stores/appStore', () => ({
  useAppStore: { getState: () => ({ setHasRegisteredPro: mockSetHasRegisteredPro }) },
}));

const { getGenericPassword: mockGetGenericPassword, setGenericPassword: mockSetGenericPassword, resetGenericPassword: mockResetGenericPassword } =
  require('react-native-keychain');
const Purchases = require('react-native-purchases').default;

const makeOffering = () => ({
  all: {},
  current: {
    identifier: 'default',
    availablePackages: [
      { identifier: '$rc_lifetime', product: { identifier: 'off_grid_pro_lifetime', priceString: '$9.99' } },
    ],
  },
});

const ENTITLEMENT_ACTIVE = { pro: { productIdentifier: 'pro_monthly' } };
const ENTITLEMENT_EMPTY = {};

describe('proLicenseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('readProFromKeychain()', () => {
    it('returns false when no keychain entry exists', async () => {
      mockGetGenericPassword.mockResolvedValueOnce(false);
      expect(await readProFromKeychain()).toBe(false);
    });

    it('returns false when keychain entry has isPro=false', async () => {
      mockGetGenericPassword.mockResolvedValueOnce({ password: JSON.stringify({ isPro: false, verifiedAt: 0 }) });
      expect(await readProFromKeychain()).toBe(false);
    });

    it('returns true when keychain entry has isPro=true', async () => {
      mockGetGenericPassword.mockResolvedValueOnce({ password: JSON.stringify({ isPro: true, verifiedAt: 0 }) });
      expect(await readProFromKeychain()).toBe(true);
    });

    it('returns false when keychain entry is malformed', async () => {
      mockGetGenericPassword.mockResolvedValueOnce({ password: 'not-json' });
      expect(await readProFromKeychain()).toBe(false);
    });
  });

  describe('checkProStatus()', () => {
    it('returns the cached keychain value immediately', async () => {
      mockGetGenericPassword.mockResolvedValueOnce({ password: JSON.stringify({ isPro: true, verifiedAt: 0 }) });
      Purchases.getCustomerInfo.mockResolvedValueOnce({ entitlements: { active: ENTITLEMENT_ACTIVE } });
      expect(await checkProStatus()).toBe(true);
    });

    it('returns false when keychain is empty', async () => {
      mockGetGenericPassword.mockResolvedValueOnce(false);
      Purchases.getCustomerInfo.mockResolvedValueOnce({ entitlements: { active: ENTITLEMENT_EMPTY } });
      expect(await checkProStatus()).toBe(false);
    });
  });

  describe('presentProPaywall()', () => {
    it('returns true and writes license when the purchase grants the entitlement', async () => {
      Purchases.getOfferings.mockResolvedValueOnce(makeOffering());
      Purchases.purchasePackage.mockResolvedValueOnce({
        customerInfo: { entitlements: { active: ENTITLEMENT_ACTIVE }, originalAppUserId: 'anon' },
      });
      mockSetGenericPassword.mockResolvedValueOnce(true);
      expect(await presentProPaywall()).toBe(true);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
    });

    it('returns false when the purchase does not grant the entitlement', async () => {
      Purchases.getOfferings.mockResolvedValueOnce(makeOffering());
      Purchases.purchasePackage.mockResolvedValueOnce({
        customerInfo: { entitlements: { active: ENTITLEMENT_EMPTY }, originalAppUserId: 'anon' },
      });
      expect(await presentProPaywall()).toBe(false);
      expect(mockSetHasRegisteredPro).not.toHaveBeenCalled();
    });

    it('returns false when the user cancels', async () => {
      Purchases.getOfferings.mockResolvedValueOnce(makeOffering());
      Purchases.purchasePackage.mockRejectedValueOnce({ userCancelled: true });
      expect(await presentProPaywall()).toBe(false);
      expect(mockSetHasRegisteredPro).not.toHaveBeenCalled();
    });
  });

  describe('restorePro()', () => {
    it('returns true and updates store when entitlement is active', async () => {
      Purchases.restorePurchases.mockResolvedValueOnce({ entitlements: { active: ENTITLEMENT_ACTIVE } });
      mockSetGenericPassword.mockResolvedValueOnce(true);
      expect(await restorePro()).toBe(true);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
    });

    it('returns false and updates store when entitlement is not active', async () => {
      Purchases.restorePurchases.mockResolvedValueOnce({ entitlements: { active: ENTITLEMENT_EMPTY } });
      mockSetGenericPassword.mockResolvedValueOnce(true);
      expect(await restorePro()).toBe(false);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(false);
    });
  });

  describe('clearProForTesting()', () => {
    it('resets keychain and clears store', async () => {
      mockResetGenericPassword.mockResolvedValueOnce(true);
      await clearProForTesting();
      expect(mockResetGenericPassword).toHaveBeenCalledTimes(1);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(false);
    });
  });

  describe('configureRevenueCat()', () => {
    it('configures RC SDK on iOS', () => {
      const Platform = require('react-native').Platform;
      Platform.OS = 'ios';
      configureRevenueCat();
      expect(Purchases.configure).toHaveBeenCalledTimes(1);
    });

    it('configures RC SDK on Android', () => {
      const Platform = require('react-native').Platform;
      Platform.OS = 'android';
      configureRevenueCat();
      expect(Purchases.configure).toHaveBeenCalledTimes(1);
    });
  });
});
