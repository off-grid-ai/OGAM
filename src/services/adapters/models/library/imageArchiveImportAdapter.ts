import type {
  ImageArchiveImportProgress,
  ImageArchiveImportResult,
} from '@offgrid/models';
import { imageArchiveImport } from '../../../composition/model-library';

/** Mobile image-archive boundary. Shared owns the transaction and typed outcome. */
export function importMobileImageArchive(input: {
  sourceUri: string;
  fileName: string;
  onProgress?(progress: ImageArchiveImportProgress): void;
}): Promise<ImageArchiveImportResult> {
  return imageArchiveImport().execute(input);
}
