// The in-app browser and Linking are the device boundary: the sheet itself is native.
jest.mock('react-native-inappbrowser-reborn', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn(), open: jest.fn(), close: jest.fn() },
}));

import { Linking } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { websiteReach } from '../../harness/websiteReach';
import {
  OfflineError,
  openProCheckout,
  startProCheckoutReturn,
  PRO_CHECKOUT_SHEET_URL,
  PRO_UNLOCK_URL,
} from '../../../src/services/proCheckout';

describe('openProCheckout', () => {
  let undoReach: () => void;
  beforeEach(() => {
    jest.clearAllMocks();
    undoReach = websiteReach(true);
  });
  afterEach(() => undoReach());

  it('opens nothing when the site does not answer, and says the phone is offline', async () => {
    undoReach();
    undoReach = websiteReach(false);
    (InAppBrowser.isAvailable as jest.Mock).mockResolvedValue(true);
    await expect(openProCheckout('pro-detail', 'dark')).rejects.toBeInstanceOf(OfflineError);
    expect(InAppBrowser.open).not.toHaveBeenCalled();
  });

  it("opens the website checkout in a sheet, in the app's theme, tagged with where the tap came from", async () => {
    (InAppBrowser.isAvailable as jest.Mock).mockResolvedValue(true);
    (InAppBrowser.open as jest.Mock).mockResolvedValue({ type: 'cancel' });
    await openProCheckout('pro-detail', 'dark');
    const [url, options] = (InAppBrowser.open as jest.Mock).mock.calls[0];
    expect(url.startsWith(`${PRO_CHECKOUT_SHEET_URL}?theme=dark&`)).toBe(true);
    expect(url).toMatch(/utm_medium=pro-detail/);
    expect(options.modalPresentationStyle).toBe('pageSheet');
  });

  it('a second tap while the sheet is opening joins it: one sheet, and no browser behind it', async () => {
    (InAppBrowser.isAvailable as jest.Mock).mockResolvedValue(true);
    (InAppBrowser.open as jest.Mock).mockResolvedValue({ type: 'cancel' });
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await Promise.all([openProCheckout('home', 'dark'), openProCheckout('home', 'dark')]);
    expect(InAppBrowser.open).toHaveBeenCalledTimes(1);
    expect(openURL).not.toHaveBeenCalled();
    // Once it settles, the next tap opens again.
    await openProCheckout('home', 'dark');
    expect(InAppBrowser.open).toHaveBeenCalledTimes(2);
  });

  it('falls back to the system browser where no in-app browser exists', async () => {
    (InAppBrowser.isAvailable as jest.Mock).mockResolvedValue(false);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await openProCheckout('pro-unlock', 'light');
    expect(InAppBrowser.open).not.toHaveBeenCalled();
    expect(openURL.mock.calls[0][0]).toMatch(/^https:\/\/getoffgridai\.co\/pro\/app\/\?theme=light&.*utm_medium=pro-unlock/);
  });
});

describe('startProCheckoutReturn', () => {
  it("closes the sheet and opens the key field on the page's way back, and ignores other links", () => {
    const listeners: ((e: { url: string }) => void)[] = [];
    const emit = (url: string) => listeners.forEach(listener => listener({ url }));
    const remove = jest.fn();
    jest.spyOn(Linking, 'addEventListener').mockImplementation(((_: string, fn: (e: { url: string }) => void) => {
      listeners.push(fn);
      return { remove };
    }) as never);
    const openUnlock = jest.fn();
    const stop = startProCheckoutReturn(openUnlock);

    emit('offgrid://oauth/callback?code=abc');
    expect(openUnlock).not.toHaveBeenCalled();

    emit(PRO_UNLOCK_URL);
    expect(InAppBrowser.close).toHaveBeenCalled();
    expect(openUnlock).toHaveBeenCalledTimes(1);

    stop();
    expect(remove).toHaveBeenCalled();
  });
});
