import { Platform, PermissionsAndroid, Share } from 'react-native';
import RNFS from 'react-native-fs';
import { showAlert, hideAlert, type AlertState } from '../../components/CustomAlert';
import { useAppStore } from '../../stores';
import { onnxImageGeneratorService } from '../../services';
import { exportGeneratedMedia } from '../../services/exportGeneratedMedia';
import { deleteGeneratedVideo } from '../../services/generatedVideoFiles';
import type { GeneratedImage, GeneratedVideo } from '../../types';
import { resolveDocumentPath } from '../../utils/resolveDocumentPath';

/**
 * Saving and deleting Gallery media: the one owner the grid, the image screen and the video screen use.
 * Each action reports to the person through `setAlertState`, the CustomAlert of the screen it runs on.
 */
type SetAlert = (state: AlertState) => void;

/** Deletes the image file and, only once it is gone, its record. False when the file could not be removed. */
export async function deleteGalleryImage(image: GeneratedImage): Promise<boolean> {
  const deleted = await onnxImageGeneratorService
    .deleteGeneratedImage(image.id, image.imagePath)
    .catch(() => false);
  if (deleted) useAppStore.getState().removeGeneratedImage(image.id);
  return deleted;
}

/** Asks first; on Delete removes the image and calls `onDeleted`, or says the image was kept. */
export function askDeleteImage(image: GeneratedImage, setAlertState: SetAlert, onDeleted: () => void): void {
  const doDelete = async () => {
    setAlertState(hideAlert());
    if (await deleteGalleryImage(image)) onDeleted();
    else setAlertState(showAlert('Image was not deleted', 'The image could not be removed. Its record is still in your Gallery.'));
  };
  setAlertState(showAlert('Delete Image', 'Are you sure you want to delete this image?', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: () => { doDelete().catch(() => { /* it shows its own alert */ }); } },
  ]));
}

/** iOS hands the image to the share sheet; Android copies it to Pictures/OffgridMobile and says where. */
export async function saveImage(image: GeneratedImage, setAlertState: SetAlert): Promise<void> {
  try {
    const imagePath = resolveDocumentPath(image.imagePath);
    if (Platform.OS === 'ios') {
      await Share.share({ url: `file://${imagePath}` });
      return;
    }
    await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      {
        title: 'Storage Permission',
        message: 'App needs access to save images',
        buttonNeutral: 'Ask Later',
        buttonNegative: 'Cancel',
        buttonPositive: 'OK',
      }
    );
    const picturesDir = `${RNFS.ExternalStorageDirectoryPath}/Pictures/OffgridMobile`;
    if (!(await RNFS.exists(picturesDir))) {
      await RNFS.mkdir(picturesDir);
    }
    const timestamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
    const fileName = `generated_${timestamp}.png`;
    await RNFS.copyFile(imagePath, `${picturesDir}/${fileName}`);
    setAlertState(showAlert('Image Saved', `Saved to Pictures/OffgridMobile/${fileName}`));
  } catch (error: any) {
    setAlertState(showAlert('Error', `Failed to save image: ${error?.message || 'Unknown error'}`));
  }
}

/** iOS shares the video; Android saves it to Downloads and says so. */
export async function saveVideo(video: GeneratedVideo, setAlertState: SetAlert): Promise<void> {
  try {
    await exportGeneratedMedia(video.videoPath, `${video.id}.mp4`, 'video/mp4');
    if (Platform.OS === 'android') setAlertState(showAlert('Saved to Downloads'));
  } catch (error: any) {
    setAlertState(showAlert('Save failed', String(error.message)));
  }
}

/** Deleting a video asks first, as the Studio's viewer does; a failure says so in the same sheet. */
export function askDeleteVideo(video: GeneratedVideo, setAlertState: SetAlert, onDeleted: () => void): void {
  setAlertState(
    showAlert('Delete this video?', 'It is removed from this phone and its chat.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteGeneratedVideo(video.id)
            .then(onDeleted)
            .catch(error => setAlertState(showAlert('Could not delete video', String(error.message))));
        },
      },
    ]),
  );
}
