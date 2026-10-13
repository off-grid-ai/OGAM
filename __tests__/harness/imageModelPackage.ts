/**
 * The image-model package boundary for a zip-style (Android sd-mnn) image download: the native
 * download module moves the finished zip into place, and react-native-zip-archive extracts it.
 *
 * Both are native, so both are faked here, writing real bytes into the in-memory file system: the
 * move puts the zip at the target path, and the unzip writes the files an xororz/sd-mnn package
 * holds into the destination folder. Everything above (finalize, the integrity check, registering
 * the model, the stores, the card) runs for real.
 */
import type { NativeBoundary } from './nativeBoundary';

/** What an xororz/sd-mnn model zip extracts to (the set the image-model integrity check expects). */
export const SD_MNN_PACKAGE_FILES = [
  'tokenizer.json',
  'pos_emb.bin',
  'token_emb.bin',
  'unet.mnn',
  'unet.mnn.weight',
  'clip_v2.mnn',
  'clip_v2.mnn.weight',
  'vae_decoder.mnn',
  'vae_decoder.mnn.weight',
] as const;

/** The Hugging Face tree listing of xororz/sd-mnn with one model zip in it. */
export function sdMnnTree(zipName: string, sizeBytes: number) {
  return [{ type: 'file', path: zipName, size: 134, lfs: { oid: 'sha', size: sizeBytes, pointerSize: 134 } }];
}

/**
 * Make the completed download land as a zip on disk, and make unzip extract a full sd-mnn package.
 * Requires a boundary installed with { fs: true, download: true }.
 */
export function installImageZipPackage(boundary: NativeBoundary): void {
  const fs = boundary.fs!;
  boundary.download!.module.moveCompletedDownload.mockImplementation(async (_id: string, target: string) => {
    fs.seedFile(target, 4096);
    return target;
  });
  const { unzip } = require('react-native-zip-archive') as { unzip: jest.Mock };
  unzip.mockImplementation(async (_zipPath: string, destination: string) => {
    for (const name of SD_MNN_PACKAGE_FILES) fs.seedFile(`${destination}/${name}`, 1024);
    return destination;
  });
}
