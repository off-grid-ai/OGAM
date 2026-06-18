import {
  readProFromKeychain,
  checkProStatus,
  presentProPaywall,
  restorePro,
  clearProForTesting,
  configureRevenueCat,
  resetProIdentityForTesting,
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

    it('still reports success when the keychain write fails after a granted purchase', async () => {
      Purchases.getOfferings.mockResolvedValueOnce(makeOffering());
      Purchases.purchasePackage.mockResolvedValueOnce({
        customerInfo: { entitlements: { active: ENTITLEMENT_ACTIVE }, originalAppUserId: 'anon' },
      });
      // A keychain failure must not turn a charged purchase into a "Purchase failed".
      mockSetGenericPassword.mockRejectedValueOnce(new Error('keychain locked'));
      expect(await presentProPaywall()).toBe(true);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
    });

    it('falls back to the first package when no $rc_lifetime package exists', async () => {
      const offering = makeOffering();
      offering.current.availablePackages = [
        { identifier: '$rc_monthly', product: { identifier: 'off_grid_pro_monthly', priceString: '$1.99' } },
      ];
      Purchases.getOfferings.mockResolvedValueOnce(offering);
      Purchases.purchasePackage.mockResolvedValueOnce({
        customerInfo: { entitlements: { active: ENTITLEMENT_ACTIVE }, originalAppUserId: 'anon' },
      });
      mockSetGenericPassword.mockResolvedValueOnce(true);
      expect(await presentProPaywall()).toBe(true);
      expect(Purchases.purchasePackage).toHaveBeenCalledWith(offering.current.availablePackages[0]);
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

  describe('presentProPaywall() error paths', () => {
    it('throws when there is no current offering', async () => {
      Purchases.getOfferings.mockResolvedValueOnce({ all: {}, current: null });
      await expect(presentProPaywall()).rejects.toThrow('No offering available');
    });

    it('throws when the current offering has no packages', async () => {
      Purchases.getOfferings.mockResolvedValueOnce({
        all: {},
        current: { identifier: 'default', availablePackages: [] },
      });
      await expect(presentProPaywall()).rejects.toThrow('No package available');
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

    it('rethrows when the RC SDK fails to configure', () => {
      Purchases.configure.mockImplementationOnce(() => {
        throw new Error('native module missing');
      });
      expect(() => configureRevenueCat()).toThrow('native module missing');
    });
  });

  describe('resetProIdentityForTesting()', () => {
    it('skips logOut for an anonymous user and clears the keychain', async () => {
      Purchases.getCustomerInfo.mockResolvedValueOnce({
        originalAppUserId: '$RCAnonymousID:abc',
        entitlements: { active: {} },
        allPurchaseDates: {},
      });
      await resetProIdentityForTesting();
      expect(Purchases.logOut).not.toHaveBeenCalled();
      expect(mockResetGenericPassword).toHaveBeenCalledTimes(1);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(false);
    });

    it('logs out an identified user before clearing the keychain', async () => {
      Purchases.getCustomerInfo
        .mockResolvedValueOnce({
          originalAppUserId: 'real-user-123',
          entitlements: { active: {} },
          allPurchaseDates: {},
        })
        .mockResolvedValueOnce({ originalAppUserId: '$RCAnonymousID:new', entitlements: { active: {} } });
      Purchases.logOut.mockResolvedValueOnce(undefined);
      await resetProIdentityForTesting();
      expect(Purchases.logOut).toHaveBeenCalledTimes(1);
      expect(mockResetGenericPassword).toHaveBeenCalledTimes(1);
    });

    it('continues clearing the keychain when the RC lookup throws', async () => {
      Purchases.getCustomerInfo.mockRejectedValueOnce(new Error('network down'));
      await resetProIdentityForTesting();
      expect(mockResetGenericPassword).toHaveBeenCalledTimes(1);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(false);
    });
  });
});
