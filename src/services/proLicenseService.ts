import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import * as Keychain from 'react-native-keychain';
import logger from '../utils/logger';
import {
  RC_API_KEY_IOS,
  RC_API_KEY_ANDROID,
  RC_API_KEY_TEST_STORE,
  USE_RC_TEST_STORE,
} from '../config/revenueCatKeys';

const KEYCHAIN_SERVICE = 'off-grid-pro-license';
const ENTITLEMENT_ID = 'pro';

type ProLicense = { isPro: boolean; verifiedAt: number };

function setProInStore(isPro: boolean): void {
  const { useAppStore } = require('../stores/appStore');
  useAppStore.getState().setHasRegisteredPro(isPro);
}

export function configureRevenueCat(): void {
  try {
    Purchases.setLogLevel(__DEV__ ? LOG_LEVEL.DEBUG : LOG_LEVEL.ERROR);
    const useTestStore = __DEV__ && USE_RC_TEST_STORE;
    const apiKey = useTestStore
      ? RC_API_KEY_TEST_STORE
      : Platform.OS === 'ios' ? RC_API_KEY_IOS : RC_API_KEY_ANDROID;
    logger.log(`[RC] configure platform=${Platform.OS} store=${useTestStore ? 'TEST' : Platform.OS} key=${apiKey.slice(0, 12)}...`);
    Purchases.configure({ apiKey });
    logger.log('[RC] configure: SDK configured OK');
  } catch (e: any) {
    logger.error(`[RC] configure FAILED: ${e?.message ?? e}`);
    throw e;
  }
}

async function writeLicense(isPro: boolean): Promise<void> {
  const license: ProLicense = { isPro, verifiedAt: Date.now() };
  logger.log(`[RC] writeLicense isPro=${isPro}`);
  await Keychain.setGenericPassword('license', JSON.stringify(license), {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK,
  });
}

export async function readProFromKeychain(): Promise<boolean> {
  try {
    const result = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!result) {
      logger.log('[RC] readProFromKeychain: no entry found → false');
      return false;
    }
    const license: ProLicense = JSON.parse(result.password);
    const age = Math.round((Date.now() - license.verifiedAt) / 1000);
    logger.log(`[RC] readProFromKeychain: isPro=${license.isPro} verifiedAt=${license.verifiedAt} age=${age}s`);
    return license.isPro ?? false;
  } catch (e: any) {
    logger.error(`[RC] readProFromKeychain error: ${e?.message ?? e}`);
    return false;
  }
}

export async function checkProStatus(): Promise<boolean> {
  logger.log('[RC] checkProStatus: reading keychain...');
  const cached = await readProFromKeychain();
  logger.log(`[RC] checkProStatus: cached=${cached}, firing background sync`);
  syncWithRevenueCat().catch(() => {});
  return cached;
}

async function syncWithRevenueCat(): Promise<void> {
  try {
    logger.log('[RC] syncWithRevenueCat: invalidating cache + fetching...');
    await Purchases.invalidateCustomerInfoCache();
    const info = await Purchases.getCustomerInfo();
    const activeKeys = Object.keys(info.entitlements.active);
    logger.log(`[RC] syncWithRevenueCat: customerID=${info.originalAppUserId}`);
    logger.log(`[RC] syncWithRevenueCat: activeEntitlements=[${activeKeys.join(', ') || 'none'}]`);
    logger.log(`[RC] syncWithRevenueCat: allPurchaseDates=${JSON.stringify(info.allPurchaseDates)}`);
    const isPro = info.entitlements.active[ENTITLEMENT_ID] !== undefined;
    if (isPro) {
      const ent = info.entitlements.active[ENTITLEMENT_ID];
      logger.log(`[RC] syncWithRevenueCat: entitlement productID=${ent?.productIdentifier} isSandbox=${ent?.isSandbox} unsubscribeDetected=${ent?.unsubscribeDetectedAt ?? 'null'}`);
    }
    logger.log(`[RC] syncWithRevenueCat: isPro=${isPro} → writing to keychain`);
    await writeLicense(isPro);
    setProInStore(isPro);
    logger.log('[RC] syncWithRevenueCat: done');
  } catch (e: any) {
    logger.error(`[RC] syncWithRevenueCat error: ${e?.message ?? e}`);
  }
}

export async function presentProPaywall(): Promise<boolean> {
  try {
    logger.log('[RC] presentProPaywall: fetching offerings...');
    const offerings = await Purchases.getOfferings();
    logger.log(`[RC] presentProPaywall: availableOfferings=[${Object.keys(offerings.all).join(', ')}] current=${offerings.current?.identifier ?? 'none'}`);
    const offering = offerings.current;
    if (!offering) {
      logger.error('[RC] presentProPaywall ABORT: no current offering (set one as current in RC)');
      throw new Error('No offering available');
    }
    logger.log(`[RC] presentProPaywall: using offering=${offering.identifier} packages=${offering.availablePackages.length}`);
    offering.availablePackages.forEach(p =>
      logger.log(`[RC]   package=${p.identifier} product=${p.product?.identifier ?? 'NONE'} price=${p.product?.priceString ?? 'NONE'}`),
    );
    const pkg = offering.availablePackages[0];
    if (!pkg) {
      logger.error('[RC] presentProPaywall ABORT: no package in offering (no store product for this platform — check the package has an Android/iOS product)');
      throw new Error('No package available');
    }
    logger.log(`[RC] presentProPaywall: purchasing package=${pkg.identifier} product=${pkg.product.identifier} price=${pkg.product.priceString}`);

    const { customerInfo } = await Purchases.purchasePackage(pkg);
    const activeKeys = Object.keys(customerInfo.entitlements.active);
    logger.log(`[RC] post-purchase activeEntitlements=[${activeKeys.join(', ') || 'none'}]`);
    const isPro = customerInfo.entitlements.active[ENTITLEMENT_ID] !== undefined;
    logger.log(`[RC] post-purchase isPro=${isPro} customerID=${customerInfo.originalAppUserId}`);
    if (isPro) {
      const ent = customerInfo.entitlements.active[ENTITLEMENT_ID];
      logger.log(`[RC] post-purchase entitlement isSandbox=${ent?.isSandbox} productID=${ent?.productIdentifier}`);
    }

    if (isPro) {
      await writeLicense(true);
      setProInStore(true);
      return true;
    }
    return false;
  } catch (e: any) {
    if (e?.userCancelled) {
      logger.log('[RC] presentProPaywall: user cancelled');
      return false;
    }
    logger.error(
      `[RC] presentProPaywall FAILED code=${e?.code} readable=${e?.readableErrorCode ?? 'n/a'} ` +
      `msg=${e?.message ?? e} underlying=${e?.underlyingErrorMessage ?? 'n/a'}`,
    );
    throw e;
  }
}

export async function restorePro(): Promise<boolean> {
  logger.log('[RC] restorePro: start');
  const info = await Purchases.restorePurchases();
  const activeKeys = Object.keys(info.entitlements.active);
  logger.log(`[RC] restorePro: activeEntitlements=[${activeKeys.join(', ') || 'none'}]`);
  const isPro = info.entitlements.active[ENTITLEMENT_ID] !== undefined;
  logger.log(`[RC] restorePro: isPro=${isPro}`);
  await writeLicense(isPro);
  setProInStore(isPro);
  return isPro;
}

export async function clearProForTesting(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  setProInStore(false);
}

export async function resetProIdentityForTesting(): Promise<void> {
  logger.log('[RC] resetProIdentityForTesting: start');
  logger.log('[RC] resetProIdentityForTesting: invalidating RC cache...');
  await Purchases.invalidateCustomerInfoCache();
  try {
    const before = await Purchases.getCustomerInfo();
    const isAnonymous = before.originalAppUserId.startsWith('$RCAnonymousID:');
    logger.log(`[RC] resetProIdentityForTesting: customerID before=${before.originalAppUserId} anonymous=${isAnonymous}`);
    logger.log(`[RC] resetProIdentityForTesting: entitlements before=[${Object.keys(before.entitlements.active).join(', ') || 'none'}]`);
    logger.log(`[RC] resetProIdentityForTesting: allPurchases before=${JSON.stringify(before.allPurchaseDates)}`);
    // logOut only works for identified users. Anonymous users can only be reset
    // by deleting the app (which clears the anonymous ID from UserDefaults).
    if (!isAnonymous) {
      await Purchases.logOut();
      await Purchases.invalidateCustomerInfoCache();
      const after = await Purchases.getCustomerInfo();
      logger.log(`[RC] resetProIdentityForTesting: logOut done, customerID after=${after.originalAppUserId}`);
    } else {
      logger.log('[RC] resetProIdentityForTesting: anonymous user — skipping logOut (delete the app to get a fresh ID)');
    }
  } catch (e: any) {
    logger.error(`[RC] resetProIdentityForTesting: ${e?.message ?? e} — continuing`);
  }
  logger.log('[RC] resetProIdentityForTesting: clearing keychain...');
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  setProInStore(false);
  logger.log('[RC] resetProIdentityForTesting: done');
}
