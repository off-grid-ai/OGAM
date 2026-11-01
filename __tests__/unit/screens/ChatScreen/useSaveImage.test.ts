/**
 * saveImageToGallery: the image viewer's Save button.
 *
 * The real function and the real showAlert run. Only the device is faked: the disk (react-native-fs,
 * the in-memory nativeFileSystem) and the Android storage permission dialog (PermissionsAndroid).
 */
import { Platform, PermissionsAndroid } from 'react-native';
import type { NativeFileSystemBoundary } from '../../../harness/nativeFileSystem';
import { saveImageToGallery } from '../../../../src/screens/ChatScreen/useSaveImage';
import type { AlertState } from '../../../../src/components';

jest.mock('react-native-fs', () => {
  const disk = require('../../../harness/nativeFileSystem').createNativeFileSystemBoundary();
  (globalThis as unknown as { __saveImageDisk: unknown }).__saveImageDisk = disk;
  return disk.module;
});
const disk = (globalThis as unknown as { __saveImageDisk: NativeFileSystemBoundary }).__saveImageDisk;

const IOS_DIR = `${disk.module.DocumentDirectoryPath}/OffgridMobile_Images`;
const ANDROID_DIR = `${disk.module.ExternalStorageDirectoryPath}/Pictures/OffgridMobile`;

describe('saveImageToGallery', () => {
  let alerts: AlertState[];
  let permissionRequests: string[];
  const setAlertState = (next: AlertState | ((prev: AlertState) => AlertState)) => {
    alerts.push(typeof next === 'function' ? next(alerts.at(-1)!) : next);
  };

  const setPlatform = (os: 'ios' | 'android') => Object.defineProperty(Platform, 'OS', { configurable: true, value: os });

  beforeEach(() => {
    disk.reset();
    alerts = [];
    permissionRequests = [];
    setPlatform('ios');
    PermissionsAndroid.request = (async (permission: string) => {
      permissionRequests.push(permission);
      return PermissionsAndroid.RESULTS.GRANTED;
    }) as typeof PermissionsAndroid.request;
    disk.seedFile('/tmp/image.png', 2048);
  });

  it('does nothing when no image is open', async () => {
    await saveImageToGallery(null, setAlertState);
    expect(alerts).toEqual([]);
    expect(disk.listFiles(IOS_DIR)).toEqual([]);
  });

  it('copies the image into the iOS documents folder, creating it, and says it saved', async () => {
    expect(await disk.exists(IOS_DIR)).toBe(false);

    await saveImageToGallery('file:///tmp/image.png', setAlertState);

    const saved = disk.listFiles(IOS_DIR);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatch(/\/generated_.+\.png$/);
    expect((await disk.module.stat(saved[0])).size).toBe(2048);
    expect(alerts).toEqual([expect.objectContaining({ visible: true, title: 'Image Saved', message: `Saved to ${saved[0].split('/').pop()}` })]);
    // The original stays where it was.
    expect(await disk.exists('/tmp/image.png')).toBe(true);
  });

  it('keeps earlier saves when the folder already exists', async () => {
    disk.seedFile(`${IOS_DIR}/generated_earlier.png`, 10);

    await saveImageToGallery('file:///tmp/image.png', setAlertState);

    expect(disk.listFiles(IOS_DIR)).toHaveLength(2);
  });

  it('shows Error when the image file is gone', async () => {
    await saveImageToGallery('file:///tmp/missing.png', setAlertState);

    expect(alerts).toEqual([expect.objectContaining({ title: 'Error', message: expect.stringMatching(/^Failed to save image: /) })]);
    expect(disk.listFiles(IOS_DIR)).toEqual([]);
  });

  it('on Android asks for storage permission and saves to Pictures/OffgridMobile', async () => {
    setPlatform('android');

    await saveImageToGallery('file:///tmp/image.png', setAlertState);

    expect(permissionRequests).toEqual([PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE]);
    const saved = disk.listFiles(ANDROID_DIR);
    expect(saved).toHaveLength(1);
    expect(alerts).toEqual([expect.objectContaining({ title: 'Image Saved', message: `Saved to Pictures/OffgridMobile/${saved[0].split('/').pop()}` })]);
  });
});
