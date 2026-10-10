import { useAppStore } from '../stores/appStore';
import { showAlert, type AlertState } from '../utils/alertState';
import { imageGenerationService } from './imageGenerationService';
import { localDreamGeneratorService } from './localDreamGenerator';

/**
 * Delete the files of a chat's generated images. An image still being drawn for the chat is
 * cancelled first and its request ends before the images are read, so it cannot add one after
 * this cleanup. A record is removed only once its file is gone; remote images can be .jpg or
 * .webp, so each delete uses the image's saved path. An image whose file stays keeps its Gallery
 * record, so the user can delete it again from the Gallery. Returns how many images could not be
 * removed.
 */
export async function deleteChatImages(conversationId: string): Promise<number> {
  await imageGenerationService.cancelGenerationFor(conversationId);
  const images = useAppStore.getState().generatedImages
    .filter(image => image.conversationId === conversationId);
  let notDeleted = 0;
  for (const image of images) {
    const deleted = await localDreamGeneratorService
      .deleteGeneratedImage(image.id, image.imagePath)
      .catch(() => false);
    if (deleted) useAppStore.getState().removeGeneratedImage(image.id);
    else notDeleted += 1;
  }
  return notDeleted;
}

/** The alert that tells the user some images from a deleted chat are still in the Gallery. */
export function imagesNotDeletedAlert(count: number, onOk?: () => void): AlertState {
  const one = count === 1;
  return showAlert(
    'Some images were not deleted',
    `${count} ${one ? 'image' : 'images'} from the deleted chat could not be removed. ${one ? 'It is' : 'They are'} still in your Gallery, where you can delete ${one ? 'it' : 'them'} again.`,
    [{ text: 'OK', onPress: onOk }],
  );
}
