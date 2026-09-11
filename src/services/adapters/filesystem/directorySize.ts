import RNFS from 'react-native-fs';
import { sizeToBytes } from '../../../utils/fileSize';

/** Filesystem boundary for recursive directory measurement. */
export async function getDirectorySize(path: string): Promise<number> {
  let total = 0;
  for (const entry of await RNFS.readDir(path)) {
    total += entry.isDirectory() ? await getDirectorySize(entry.path) : sizeToBytes(entry.size);
  }
  return total;
}
