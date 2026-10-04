import RNFS from 'react-native-fs';
import type {
  GeneratedImageReleaseIntent,
  MobileGeneratedImageGalleryRepository,
} from '../generated-image-gallery';
import { deleteConfinedRegularFile } from '../native/confinedRegularFileDeletion';
import type {
  MobileLocalResourcePrivacyScope,
  MobileOwnedDirectoryPrivacyPort,
} from './mobileLocalResourcePrivacyWorkflow';

const generatedImagesDirectory = () =>
  `${RNFS.DocumentDirectoryPath.replace(/\/$/, '')}/generated_images`;

interface CleanupInput {
  readonly scope: MobileLocalResourcePrivacyScope;
  readonly operationId: string;
}

/** Confined residual-byte cleanup after canonical gallery and release owners prove empty. */
export class MobileOwnedDirectoryPrivacy
  implements MobileOwnedDirectoryPrivacyPort
{
  constructor(
    private readonly gallery: MobileGeneratedImageGalleryRepository,
    private readonly settleImage: (
      intent: GeneratedImageReleaseIntent,
    ) => Promise<void>,
  ) {}

  async cleanup(input: CleanupInput): Promise<void> {
    await this.requireEmptyGallery();
    const release = await this.gallery.drainByteDeletions(this.settleImage);
    if (release.retained.length !== 0) {
      throw new Error(
        `Generated-image byte settlement retained ${String(
          release.retained.length,
        )} operation(s).`,
      );
    }
    const entries = await this.entries();
    for (const entry of entries) {
      if (!entry.isFile()) {
        throw new Error(
          `Generated-image cleanup found an unknown entry: ${entry.name}.`,
        );
      }
      const expectedPath = `${generatedImagesDirectory()}/${entry.name}`;
      if (entry.path !== expectedPath || entry.name.includes('/')) {
        throw new Error(
          'Generated-image cleanup found an unsafe path identity.',
        );
      }
      const outcome = await deleteConfinedRegularFile({
        root: 'documents',
        expectedPath,
        operationId: input.operationId,
      });
      if (outcome.status === 'refused') {
        throw new Error(`${outcome.code}: ${outcome.message}`);
      }
    }
  }

  async verify(_input: CleanupInput): Promise<void> {
    await this.requireEmptyGallery();
    this.gallery.verifyByteDeletionsSettled();
    const entries = await this.entries();
    if (entries.length !== 0) {
      throw new Error('Generated-image directory cleanup is not complete.');
    }
  }

  private async requireEmptyGallery(): Promise<void> {
    const snapshot = await this.gallery.read();
    if (snapshot.images.length !== 0) {
      throw new Error(
        'Canonical generated-image records must settle before directory cleanup.',
      );
    }
  }

  private async entries() {
    const directory = generatedImagesDirectory();
    if (!(await RNFS.exists(directory))) return [];
    return (await RNFS.readDir(directory)).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
  }
}
