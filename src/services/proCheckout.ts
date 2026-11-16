/**
 * Get Pro opens the website's checkout in a sheet over the app (Safari View Controller on iOS,
 * Chrome Custom Tabs on Android). The page holds the live price and the payment, so a price
 * change never needs an app release. Where no in-app browser exists, the system browser opens.
 */
import { Linking } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { withUtm } from '../utils/utm';

/** getoffgridai.co/pro/app/: the buy card alone, no site header or footer. */
export const PRO_CHECKOUT_SHEET_URL = 'https://getoffgridai.co/pro/app/';

/** Opens checkout; `medium` tags where the tap came from. Rejects only when nothing could open. */
export async function openProCheckout(medium: string): Promise<void> {
  const url = withUtm(PRO_CHECKOUT_SHEET_URL, medium);
  if (await InAppBrowser.isAvailable().catch(() => false)) {
    await InAppBrowser.open(url, {
      modalPresentationStyle: 'pageSheet',
      dismissButtonStyle: 'close',
      modalEnabled: true,
      showTitle: false,
      enableUrlBarHiding: true,
      enableDefaultShare: false,
    });
    return;
  }
  await Linking.openURL(url);
}
