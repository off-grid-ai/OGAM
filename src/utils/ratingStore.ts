import { Linking, Platform } from 'react-native';
import { getInstallerPackageName } from 'react-native-device-info';

/**
 * Where a rating for this install counts: the store that installed the app.
 *
 * Each store counts only its own ratings, so a Galaxy Store install sent to Google Play gives a rating
 * nobody sees. Android reports the installer's package name; that picks the store. An install with no
 * known store (a website download, adb) keeps the Play listing.
 */

const PACKAGE = 'ai.offgridmobile';

export type RatingStoreId = 'app_store' | 'play' | 'galaxy' | 'appgallery' | 'xiaomi';

export interface RatingStore {
  id: RatingStoreId;
  /** Opens the listing in the store's own app. Tried first. */
  appUrl?: string;
  /** The listing on the web, for when the store app does not open. */
  webUrl?: string;
  /** The store's in-app review dialog shows for this install (App Store, or a build Play installed). */
  nativeReview: boolean;
}

const APP_STORE: RatingStore = {
  id: 'app_store',
  // action=write-review opens the review sheet on arrival, not just the listing.
  webUrl: 'https://apps.apple.com/app/id6759299882?action=write-review',
  nativeReview: true,
};

const PLAY_LINKS = {
  appUrl: `market://details?id=${PACKAGE}`,
  webUrl: `https://play.google.com/store/apps/details?id=${PACKAGE}`,
};

const XIAOMI: RatingStore = {
  id: 'xiaomi',
  appUrl: `mimarket://details?id=${PACKAGE}`,
  webUrl: `https://global.app.mi.com/details?id=${PACKAGE}`,
  nativeReview: false,
};

/** Installer package name → store. Add a row when the app goes live on another store. */
const BY_INSTALLER: Readonly<Record<string, RatingStore>> = {
  'com.android.vending': { id: 'play', ...PLAY_LINKS, nativeReview: true },
  'com.sec.android.app.samsungapps': {
    id: 'galaxy',
    appUrl: `samsungapps://ProductDetail/${PACKAGE}`,
    webUrl: `https://galaxystore.samsung.com/detail/${PACKAGE}`,
    nativeReview: false,
  },
  // AppGallery's web listing needs its own app id, which only exists once the listing is live.
  'com.huawei.appmarket': { id: 'appgallery', appUrl: `appmarket://details?id=${PACKAGE}`, nativeReview: false },
  'com.xiaomi.mipicks': XIAOMI,
  'com.xiaomi.market': XIAOMI,
};

/** No known store installed this build: keep the Play listing, without Play's dialog (it would not show). */
const UNKNOWN_SOURCE: RatingStore = { id: 'play', ...PLAY_LINKS, nativeReview: false };

/** The store this install should be rated on. */
export async function ratingStore(): Promise<RatingStore> {
  if (Platform.OS === 'ios') return APP_STORE;
  const installer = await getInstallerPackageName().catch(() => '');
  return BY_INSTALLER[installer] ?? UNKNOWN_SOURCE;
}

/**
 * Open the store's listing: its own app first, else the web page.
 *
 * openURL rather than canOpenURL: Android 11+ hides other apps from canOpenURL unless the manifest
 * lists them, so it would say no for a store app that is on the phone. openURL rejects only when
 * nothing handles the link.
 */
export async function openStoreListing(store: RatingStore): Promise<void> {
  const urls = [store.appUrl, store.webUrl].filter((url): url is string => Boolean(url));
  let lastError: unknown = new Error(`Store ${store.id} has no listing link`);
  for (const url of urls) {
    try {
      await Linking.openURL(url);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}
