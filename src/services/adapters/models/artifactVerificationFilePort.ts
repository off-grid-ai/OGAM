import { Buffer } from 'buffer';
import type { ArtifactVerificationFilePort } from '@offgrid/models';
import RNFS from 'react-native-fs';
import { statFile } from '../../../utils/fileStat';

/** React Native filesystem adapter. It contains no artifact policy. */
export const mobileArtifactVerificationFiles: ArtifactVerificationFilePort = {
  async stat(path) {
    const facts = await statFile(path);
    return facts
      ? { exists: true, isFile: facts.isFile, sizeBytes: facts.size }
      : { exists: false, isFile: false, sizeBytes: 0 };
  },
  async readPrefix(path, bytes) {
    const value = await RNFS.read(path, bytes, 0, 'ascii');
    return Uint8Array.from(Buffer.from(value, 'ascii'));
  },
  async remove(path) {
    await RNFS.unlink(path);
  },
};
