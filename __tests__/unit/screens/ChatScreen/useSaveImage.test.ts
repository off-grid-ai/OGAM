/**
 * useSaveImage Unit Tests
 */

jest.mock('react-native', () => ({
  Platform: { OS: 'ios', Version: 17, select: (obj: any) => obj.ios },
  PermissionsAndroid: {
    request: jest.fn(),
    PERMISSIONS: { WRITE_EXTERNAL_STORAGE: 'android.permission.WRITE_EXTERNAL_STORAGE' },
    RESULTS: { GRANTED: 'granted', DENIED: 'denied' },
  },
}));

const mockSaveAsset = jest.fn();
jest.mock('@react-native-camera-roll/camera-roll', () => ({
  CameraRoll: { saveAsset: (...args: any[]) => mockSaveAsset(...args) },
}));

jest.mock('../../../../src/utils/logger', () => ({
  __esModule: true,
  default: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
}));

jest.mock('../../../../src/components', () => ({
  showAlert: (title: string, message: string) => ({ visible: true, title, message, buttons: [] }),
}));

import { Platform, PermissionsAndroid } from 'react-native';
import { saveImageToGallery } from '../../../../src/screens/ChatScreen/useSaveImage';

const mockRequest = PermissionsAndroid.request as jest.Mock;

describe('saveImageToGallery', () => {
  const setAlertState = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveAsset.mockResolvedValue('ph://saved-asset');
    mockRequest.mockResolvedValue('granted');
    (Platform as any).OS = 'ios';
    (Platform as any).Version = 17;
  });

  it('does nothing when viewerImageUri is null', async () => {
    await saveImageToGallery(null, setAlertState);
    expect(mockSaveAsset).not.toHaveBeenCalled();
    expect(setAlertState).not.toHaveBeenCalled();
  });

  it('saves to the photo gallery via CameraRoll (iOS, no permission prompt)', async () => {
    await saveImageToGallery('file:///tmp/image.png', setAlertState);
    expect(mockSaveAsset).toHaveBeenCalledWith('file:///tmp/image.png', { type: 'photo', album: 'OffgridMobile' });
    expect(mockRequest).not.toHaveBeenCalled();
  });

  it('passes the uri through unchanged (CameraRoll handles file:// itself)', async () => {
    await saveImageToGallery('file:///path/to/image.png', setAlertState);
    const [uri] = mockSaveAsset.mock.calls[0];
    expect(uri).toBe('file:///path/to/image.png');
  });

  it('shows Image Saved alert on success', async () => {
    await saveImageToGallery('file:///tmp/img.png', setAlertState);
    expect(setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Image Saved' }),
    );
  });

  it('shows Error alert when saveAsset throws', async () => {
    mockSaveAsset.mockRejectedValue(new Error('disk full'));
    await saveImageToGallery('file:///tmp/img.png', setAlertState);
    expect(setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Error' }),
    );
  });

  it('requests WRITE_EXTERNAL_STORAGE on Android below API 33', async () => {
    (Platform as any).OS = 'android';
    (Platform as any).Version = 30;
    await saveImageToGallery('file:///tmp/img.png', setAlertState);
    expect(mockRequest).toHaveBeenCalledWith(
      'android.permission.WRITE_EXTERNAL_STORAGE',
      expect.any(Object),
    );
    expect(mockSaveAsset).toHaveBeenCalled();
  });

  it('skips the permission prompt on Android 33+ (scoped media)', async () => {
    (Platform as any).OS = 'android';
    (Platform as any).Version = 34;
    await saveImageToGallery('file:///tmp/img.png', setAlertState);
    expect(mockRequest).not.toHaveBeenCalled();
    expect(mockSaveAsset).toHaveBeenCalled();
  });

  it('does not save and warns when Android permission is denied', async () => {
    (Platform as any).OS = 'android';
    (Platform as any).Version = 30;
    mockRequest.mockResolvedValue('denied');
    await saveImageToGallery('file:///tmp/img.png', setAlertState);
    expect(mockSaveAsset).not.toHaveBeenCalled();
    expect(setAlertState).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Permission needed' }),
    );
  });
});
