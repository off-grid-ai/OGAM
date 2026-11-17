/**
 * Get Pro opens the website's checkout in a sheet over the app (Safari View Controller on iOS,
 * Chrome Custom Tabs on Android). The page holds the live price and the payment, so a price
 * change never needs an app release. Where no in-app browser exists, the system browser opens.
 *
 * After payment the page offers "Paste your key in the app", a link to offgrid://pro/unlock:
 * the app closes the sheet and opens the key field (startProCheckoutReturn).
 */
import { Linking } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { withUtm } from '../utils/utm';

/** getoffgridai.co/pro/app/: the buy card alone, no site header or footer. */
export const PRO_CHECKOUT_SHEET_URL = 'https://getoffgridai.co/pro/app/';
/** The page's way back: closes the sheet and opens the key field. */
export const PRO_UNLOCK_URL = 'offgrid://pro/unlock';

/**
 * Opens checkout; `medium` tags where the tap came from, `theme` keeps the page in the app's
 * light or dark. Rejects only when nothing could open.
 */
export async function openProCheckout(medium: string, theme: 'dark' | 'light'): Promise<void> {
  await openWebSheet(withUtm(`${PRO_CHECKOUT_SHEET_URL}?theme=${theme}`, medium));
}

/** Opens one of our web pages in a sheet over the app, else in the system browser. */
export async function openWebSheet(url: string): Promise<void> {
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

/** Listens for the page's way back; returns the unsubscribe. */
export function startProCheckoutReturn(openUnlock: () => void): () => void {
  const sub = Linking.addEventListener('url', ({ url }) => {
    if (!url.startsWith(PRO_UNLOCK_URL)) return;
    try { InAppBrowser.close(); } catch { /* the sheet already closed itself */ }
    openUnlock();
  });
  return () => sub.remove();
}
