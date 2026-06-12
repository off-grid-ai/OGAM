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
  default: { setLogLevel: jest.fn(), configure: jest.fn(), getCustomerInfo: jest.fn(), restorePurchases: jest.fn() },
  LOG_LEVEL: { DEBUG: 'debug', ERROR: 'error' },
}), { virtual: true });

jest.mock('react-native-purchases-ui', () => ({
  __esModule: true,
  default: { presentPaywall: jest.fn() },
  PAYWALL_RESULT: { PURCHASED: 'PURCHASED', RESTORED: 'RESTORED', NOT_PRESENTED: 'NOT_PRESENTED', ERROR: 'ERROR', CANCELLED: 'CANCELLED' },
}), { virtual: true });

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
const RevenueCatUI = require('react-native-purchases-ui').default;
const { PAYWALL_RESULT } = require('react-native-purchases-ui');

const ENTITLEMENT_ACTIVE = { 'offgrid Pro': { productIdentifier: 'pro_monthly' } };
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
    it('returns true and writes license when PURCHASED', async () => {
      RevenueCatUI.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.PURCHASED);
      mockSetGenericPassword.mockResolvedValueOnce(true);
      expect(await presentProPaywall()).toBe(true);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
    });

    it('returns true and writes license when RESTORED', async () => {
      RevenueCatUI.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.RESTORED);
      mockSetGenericPassword.mockResolvedValueOnce(true);
      expect(await presentProPaywall()).toBe(true);
      expect(mockSetHasRegisteredPro).toHaveBeenCalledWith(true);
    });

    it('returns false when CANCELLED', async () => {
      RevenueCatUI.presentPaywall.mockResolvedValueOnce(PAYWALL_RESULT.CANCELLED);
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
