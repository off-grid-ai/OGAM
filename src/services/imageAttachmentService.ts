import RNFS from 'react-native-fs';
import type { MediaAttachment } from '../types';

const IMAGE_ATTACHMENTS_DIR = `${RNFS.DocumentDirectoryPath}/attachments/images`;
let attachmentSequence = 0;

function fileExtension(fileName?: string, mimeType?: string): string {
  const extension = fileName?.match(/\.[a-z0-9]+$/i)?.[0];
  if (extension) return extension.toLowerCase();
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/heic') return '.heic';
  return '.jpg';
}

class ImageAttachmentService {
  async persistPickedImage(input: {
    uri: string;
    mimeType?: string;
    width?: number;
    height?: number;
    fileName?: string;
  }): Promise<MediaAttachment> {
    await RNFS.mkdir(IMAGE_ATTACHMENTS_DIR);
    const id = `${Date.now()}-${(++attachmentSequence).toString(36)}`;
    const destination = `${IMAGE_ATTACHMENTS_DIR}/${id}${fileExtension(
      input.fileName,
      input.mimeType,
    )}`;
    await RNFS.copyFile(input.uri, destination);
    if (!(await RNFS.exists(destination))) {
      throw new Error('The selected image could not be saved.');
    }
    return {
      id,
      type: 'image',
      uri: destination,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      fileName: input.fileName,
    };
  }

  async exists(uri: string): Promise<boolean> {
    if (!uri || /^(https?|data):\/\//i.test(uri)) return true;
    try {
      return await RNFS.exists(uri);
    } catch {
      return false;
    }
  }
}

export const imageAttachmentService = new ImageAttachmentService();
