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

/** Our website did not answer: the sheet would only show the browser's error page, so the
 * caller shows its own offline state instead. */
export class OfflineError extends Error {
  constructor() {
    super('offline');
    this.name = 'OfflineError';
  }
}

/** How long a page may take to answer before we call the phone offline. */
const REACH_WAIT_MS = 5000;

/** Whether our website answers at all (any status counts). */
async function siteReachable(url: string): Promise<boolean> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REACH_WAIT_MS);
  try {
    await fetch(url, { method: 'HEAD', signal: abort.signal });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Opens one of our web pages in a sheet over the app, else in the system browser. Rejects with
 * OfflineError when the site does not answer.
 */
export function openWebSheet(url: string): Promise<void> {
  // A second tap while the first is still opening joins it: two opens would make iOS refuse the
  // second sheet, and the page would open again in the browser behind it.
  opening ??= openOnce(url).finally(() => {
    opening = null;
  });
  return opening;
}
let opening: Promise<void> | null = null;

async function openOnce(url: string): Promise<void> {
  if (!(await siteReachable(url))) throw new OfflineError();
  if (await InAppBrowser.isAvailable().catch(() => false)) {
    // The sheet can still refuse (Android: "No activity" under the new architecture); then the
    // system browser opens the page, so the tap is never a dead end.
    const opened = await InAppBrowser.open(url, {
      modalPresentationStyle: 'pageSheet',
      dismissButtonStyle: 'close',
      modalEnabled: true,
      showTitle: false,
      enableUrlBarHiding: true,
      enableDefaultShare: false,
    }).then(() => true, () => false);
    if (opened) return;
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
