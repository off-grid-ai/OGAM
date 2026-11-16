// The in-app browser and Linking are the device boundary: the sheet itself is native.
jest.mock('react-native-inappbrowser-reborn', () => ({
  __esModule: true,
  default: { isAvailable: jest.fn(), open: jest.fn() },
}));

import { Linking } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { openProCheckout, PRO_CHECKOUT_SHEET_URL } from '../../../src/services/proCheckout';

describe('openProCheckout', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the website checkout in a sheet, tagged with where the tap came from', async () => {
    (InAppBrowser.isAvailable as jest.Mock).mockResolvedValue(true);
    (InAppBrowser.open as jest.Mock).mockResolvedValue({ type: 'cancel' });
    await openProCheckout('pro-detail');
    const [url, options] = (InAppBrowser.open as jest.Mock).mock.calls[0];
    expect(url.startsWith(PRO_CHECKOUT_SHEET_URL)).toBe(true);
    expect(url).toMatch(/utm_medium=pro-detail/);
    expect(options.modalPresentationStyle).toBe('pageSheet');
  });

  it('falls back to the system browser where no in-app browser exists', async () => {
    (InAppBrowser.isAvailable as jest.Mock).mockResolvedValue(false);
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await openProCheckout('pro-unlock');
    expect(InAppBrowser.open).not.toHaveBeenCalled();
    expect(openURL.mock.calls[0][0]).toMatch(/^https:\/\/getoffgridai\.co\/pro\/app\/.*utm_medium=pro-unlock/);
  });
});
