import { Platform } from 'react-native';
// @ts-ignore — remove after: npm install react-native-purchases react-native-purchases-ui
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
// @ts-ignore
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import * as Keychain from 'react-native-keychain';

const KEYCHAIN_SERVICE = 'off-grid-pro-license';
const ENTITLEMENT_ID = 'offgrid Pro';
const RC_API_KEY_IOS = 'test_UDUmOVwoEWFUtYONRUfQOOjVisB';
const RC_API_KEY_ANDROID = 'test_UDUmOVwoEWFUtYONRUfQOOjVisB';

type ProLicense = { isPro: boolean; verifiedAt: number };

function setProInStore(isPro: boolean): void {
  const { useAppStore } = require('../stores/appStore');
  useAppStore.getState().setHasRegisteredPro(isPro);
}

export function configureRevenueCat(): void {
  Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
  Purchases.configure({
    apiKey: Platform.OS === 'ios' ? RC_API_KEY_IOS : RC_API_KEY_ANDROID,
  });
}

async function writeLicense(isPro: boolean): Promise<void> {
  const license: ProLicense = { isPro, verifiedAt: Date.now() };
  await Keychain.setGenericPassword('license', JSON.stringify(license), {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
  });
}

export async function readProFromKeychain(): Promise<boolean> {
  try {
    const result = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!result) return false;
    const license: ProLicense = JSON.parse(result.password);
    return license.isPro ?? false;
  } catch {
    return false;
  }
}

export async function checkProStatus(): Promise<boolean> {
  const cached = await readProFromKeychain();
  syncWithRevenueCat().catch(() => {});
  return cached;
}

async function syncWithRevenueCat(): Promise<void> {
  try {
    const info = await Purchases.getCustomerInfo();
    const isPro = info.entitlements.active[ENTITLEMENT_ID] !== undefined;
    await writeLicense(isPro);
    setProInStore(isPro);
  } catch {
    // No network — cached value stands
  }
}

export async function presentProPaywall(): Promise<boolean> {
  const result: PAYWALL_RESULT = await RevenueCatUI.presentPaywall();
  switch (result) {
    case PAYWALL_RESULT.PURCHASED:
    case PAYWALL_RESULT.RESTORED: {
      await writeLicense(true);
      setProInStore(true);
      return true;
    }
    default:
      return false;
  }
}

export async function restorePro(): Promise<boolean> {
  const info = await Purchases.restorePurchases();
  const isPro = info.entitlements.active[ENTITLEMENT_ID] !== undefined;
  await writeLicense(isPro);
  setProInStore(isPro);
  return isPro;
}

export async function clearProForTesting(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  setProInStore(false);
}
