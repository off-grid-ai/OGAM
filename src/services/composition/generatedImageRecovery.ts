import type {OffGridApplication} from '@offgrid/application';
import logger from '../../utils/logger';
import {
  importLegacyGeneratedImages,
  MobileGeneratedImageGalleryRepository,
  type GeneratedImageReleaseIntent,
} from '../adapters/generated-image-gallery';

/**
 * What the post-root generated-image recovery stage needs, and nothing else.
 *
 * The stage takes its collaborators as ports so the ordering decision it owns is separable from the
 * composition root that supplies them.
 */
export interface GeneratedImageRecoveryStage {
  readonly application: Pick<
    OffGridApplication,
    'generatedImages' | 'reportDegraded'
  >;
  readonly repository: MobileGeneratedImageGalleryRepository;
  readonly settle: (intent: GeneratedImageReleaseIntent) => Promise<void>;
}

/**
 * Admit the generated-image gallery's recovery under the RUNNING application.
 *
 * This runs after the root already reported `running`, so the lifecycle rule is: nothing here may
 * throw out of the start wrapper. It previously did, and the two states then contradicted each
 * other - the Shared root ran and owned every domain while the wrapper reported a start failure,
 * stopped model services, and skipped the application-started hook, which is how the late Pro owner
 * (and the Shared File transport a provenance release needs) is installed. One unreachable image
 * path could leave the app running with no Pro surface and no way to install the only owner able to
 * release the bytes it failed on.
 *
 * So the running root is the ONE lifecycle owner of this stage's outcome: a retained intent, a
 * refused legacy import, or an uncomposed gallery becomes a `generatedImages` degradation on the
 * snapshot - the way cold-start download recovery reports itself - cleared on a clean pass so a
 * later drain is not shadowed by a stale entry. The repository retains every durable retry record,
 * so nothing reported here is lost: the scope drains, the admission drain, and the next start
 * re-run it.
 */
export async function admitGeneratedImageRecovery(
  stage: GeneratedImageRecoveryStage,
): Promise<void> {
  const report = (reason: string | null) =>
    stage.application.reportDegraded({
      domain: 'generatedImages',
      source: 'generated image recovery',
      reason,
    });
  try {
    const gallery = stage.application.generatedImages;
    if (!gallery) {
      throw new Error('Generated image gallery was not composed.');
    }
    await importLegacyGeneratedImages(stage.repository, gallery);
    const pass = await stage.repository.drainByteDeletions(stage.settle);
    if (pass.retained.length === 0) {
      return report(null);
    }
    logger.error(
      '[Application] Generated-image byte recovery retained intents',
      pass.retained,
    );
    const retained = pass.retained
      .map(entry => `${entry.id} (${entry.reason})`)
      .join('; ');
    report(
      `${pass.retained.length} of ${pass.attempted} generated-image byte release(s) were retained for retry: ${retained}`,
    );
  } catch (error) {
    logger.error('[Application] Generated-image recovery failed', error);
    report(error instanceof Error ? error.message : String(error));
  }
}
