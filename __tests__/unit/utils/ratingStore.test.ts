import { Linking, Platform } from 'react-native';
import { getInstallerPackageName } from 'react-native-device-info';
import { openStoreListing, ratingStore } from '../../../src/utils/ratingStore';

const installer = getInstallerPackageName as jest.Mock;
const openURL = Linking.openURL as jest.Mock;
const originalPlatform = Platform.OS;
const setOS = (os: string) => Object.defineProperty(Platform, 'OS', { configurable: true, value: os });

afterAll(() => setOS(originalPlatform));

describe('ratingStore - the installer picks the store', () => {
  beforeEach(() => setOS('android'));

  it.each([
    ['com.android.vending', 'play', true],
    ['com.sec.android.app.samsungapps', 'galaxy', false],
    ['com.huawei.appmarket', 'appgallery', false],
    ['com.xiaomi.mipicks', 'xiaomi', false],
    ['com.xiaomi.market', 'xiaomi', false],
    ['', 'play', false],
    ['com.some.unknown.store', 'play', false],
  ])('installer %p rates on %p (Play dialog: %p)', async (source, id, nativeReview) => {
    installer.mockResolvedValue(source);
    await expect(ratingStore()).resolves.toMatchObject({ id, nativeReview });
  });

  it('treats an installer the system will not name as an unknown source', async () => {
    installer.mockRejectedValue(new Error('denied'));
    await expect(ratingStore()).resolves.toMatchObject({ id: 'play', nativeReview: false });
  });

  it('is the App Store on iOS, whatever the installer says', async () => {
    setOS('ios');
    installer.mockResolvedValue('com.sec.android.app.samsungapps');
    await expect(ratingStore()).resolves.toMatchObject({ id: 'app_store', nativeReview: true });
  });
});

describe('openStoreListing - store app first, else the web page', () => {
  beforeEach(() => openURL.mockReset());

  it('opens AppGallery by its app link (no web listing yet)', async () => {
    openURL.mockResolvedValue(undefined);
    await openStoreListing({ id: 'appgallery', appUrl: 'appmarket://details?id=ai.offgridmobile', nativeReview: false });
    expect(openURL.mock.calls).toEqual([['appmarket://details?id=ai.offgridmobile']]);
  });

  it('opens the web listing when the store app is missing', async () => {
    openURL.mockRejectedValueOnce(new Error('No Activity found')).mockResolvedValueOnce(undefined);
    await openStoreListing({ id: 'xiaomi', appUrl: 'mimarket://x', webUrl: 'https://global.app.mi.com/x', nativeReview: false });
    expect(openURL.mock.calls).toEqual([['mimarket://x'], ['https://global.app.mi.com/x']]);
  });

  it('rejects when nothing opens either link', async () => {
    openURL.mockRejectedValue(new Error('No Activity found'));
    await expect(
      openStoreListing({ id: 'galaxy', appUrl: 'samsungapps://x', webUrl: 'https://galaxystore.samsung.com/x', nativeReview: false }),
    ).rejects.toThrow('No Activity found');
  });

  it('rejects a store with no link at all', async () => {
    await expect(openStoreListing({ id: 'play', nativeReview: false })).rejects.toThrow('has no listing link');
    expect(openURL).not.toHaveBeenCalled();
  });
});
