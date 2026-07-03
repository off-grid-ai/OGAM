import { Dispatch, SetStateAction } from 'react';
import { Platform, PermissionsAndroid } from 'react-native';
import { CameraRoll } from '@react-native-camera-roll/camera-roll';
import { AlertState, showAlert } from '../../components';
import logger from '../../utils/logger';

const ALBUM_NAME = 'OffgridMobile';

/**
 * Request the runtime permission needed to write to the device gallery.
 * iOS uses the NSPhotoLibraryAdd* Info.plist string (CameraRoll prompts itself).
 * Android only needs WRITE_EXTERNAL_STORAGE on API < 33; newer versions let apps
 * add to the media store without it, so a denial there isn't fatal.
 */
async function ensureGalleryPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  if (Number(Platform.Version) >= 33) return true;
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
    {
      title: 'Storage Permission',
      message: 'App needs access to save images',
      buttonNeutral: 'Ask Later',
      buttonNegative: 'Cancel',
      buttonPositive: 'OK',
    },
  );
  return result === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Save an image to the device photo gallery. Uses CameraRoll so the file lands
 * in the real Photos app (iOS) / gallery MediaStore (Android) — user-visible in
 * the system photos app — rather than an app-private folder.
 */
export async function saveImageToGallery(
  viewerImageUri: string | null,
  setAlertState: Dispatch<SetStateAction<AlertState>>,
): Promise<void> {
  if (!viewerImageUri) return;
  try {
    const granted = await ensureGalleryPermission();
    if (!granted) {
      setAlertState(showAlert('Permission needed', 'Allow storage access to save images to your gallery.'));
      return;
    }
    await CameraRoll.saveAsset(viewerImageUri, { type: 'photo', album: ALBUM_NAME });
    setAlertState(showAlert('Image Saved', `Saved to your ${ALBUM_NAME} album.`));
  } catch (error: any) {
    logger.error('[ChatScreen] Failed to save image:', error);
    setAlertState(showAlert('Error', `Failed to save image: ${error?.message || 'Unknown error'}`));
  }
}
