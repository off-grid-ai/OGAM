import type { GeneratedImageGalleryFacade } from '@offgrid/application';
import type {
  GeneratedImageReleaseIntent,
  MobileGeneratedImageGalleryRepository,
} from '../generated-image-gallery';
import type { MobileCanonicalImagePrivacyPort } from './mobileLocalResourcePrivacyWorkflow';

interface Options {
  readonly gallery: () => GeneratedImageGalleryFacade | undefined;
  readonly repository: MobileGeneratedImageGalleryRepository;
  readonly settle: (intent: GeneratedImageReleaseIntent) => Promise<void>;
}

/** Remove canonical image records and settle their existing durable byte journal. */
export class MobileCanonicalImagePrivacy
  implements MobileCanonicalImagePrivacyPort
{
  constructor(private readonly options: Options) {}

  async deleteAll(operationId: string): Promise<void> {
    const gallery = this.requiredGallery();
    const ids = gallery
      .snapshot()
      .images.map(image => image.id)
      .sort();
    for (const id of ids) {
      const scope = `local-resource-privacy:${operationId}:${id}`;
      this.options.repository.captureByteDeletionScope(
        scope,
        [id],
        operationId,
      );
      const outcome = await gallery.remove(id);
      if (!outcome.ok && outcome.failure.kind !== 'not_found') {
        throw new Error(outcome.failure.message);
      }
      if (!outcome.ok) {
        const cancellation = this.options.repository.cancelUnresolvableWaiter({
          scope,
          imageId: id,
          deletionOperationId: operationId,
        });
        if (!cancellation.ok) throw new Error(cancellation.message);
        continue;
      }
      await this.options.repository.drainByteDeletionsForScope(
        scope,
        this.options.settle,
      );
    }
    const remaining = await this.options.repository.drainByteDeletions(
      this.options.settle,
    );
    if (remaining.retained.length !== 0) {
      throw new Error(
        `Generated-image privacy retained ${String(
          remaining.retained.length,
        )} byte operation(s).`,
      );
    }
  }

  async verifyEmpty(operationId: string): Promise<void> {
    if (this.requiredGallery().snapshot().images.length !== 0) {
      throw new Error('Canonical generated-image deletion is not complete.');
    }
    this.options.repository.verifyByteDeletionsSettled();
    this.options.repository.clearWaiterCancellations(operationId);
  }

  private requiredGallery(): GeneratedImageGalleryFacade {
    const gallery = this.options.gallery();
    if (!gallery)
      throw new Error('Canonical generated-image gallery is not ready.');
    return gallery;
  }
}
