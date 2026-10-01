import {
  NativeModules,
  PermissionsAndroid,
  Platform,
  Share,
} from 'react-native';
import RNFS from 'react-native-fs';
import { resolveDocumentPath } from '../utils/resolveDocumentPath';

/** One export boundary for app-owned generated media. */
export async function exportGeneratedMedia(
  path: string,
  fileName: string,
  mime: string,
): Promise<void> {
  const source = resolveDocumentPath(path);
  if (Platform.OS === 'ios') {
    await Share.share({ url: `file://${source}` });
    return;
  }
  if (Number(Platform.Version) >= 29) {
    await NativeModules.SyncDownloadsModule.saveFileToDownloads(
      source,
      fileName,
      mime,
    );
    return;
  }
  const permission = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
  );
  if (permission !== PermissionsAndroid.RESULTS.GRANTED)
    throw new Error('Storage permission is required to save the file.');
  if (
    !source.startsWith(RNFS.DocumentDirectoryPath + '/') ||
    source.split('/').includes('..') ||
    /[/\\]/.test(fileName)
  ) {
    throw new Error('Invalid media export path.');
  }
  await RNFS.copyFile(source, `${RNFS.DownloadDirectoryPath}/${fileName}`);
}
