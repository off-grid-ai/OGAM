import type {
  GeneratedImageGalleryFacade,
  GeneratedImageRecord,
  ProjectDeletionCleanupPort,
  DeletionCleanupContinuation,
} from '@offgrid/application';
import type { DB } from '@op-engineering/op-sqlite';
import type { GeneratedImageReleaseIntent } from '../generated-image-gallery/mobileGeneratedImageGalleryRepository';
import type { GeneratedImageReleaseSettlement } from '../generated-image-gallery/mobileGeneratedImageGalleryRepository';
import { MobileGeneratedImageGalleryRepository } from '../generated-image-gallery/mobileGeneratedImageGalleryRepository';
import { openWorkspaceContentDatabase } from './workspaceContentDatabase';
import {
  mobileGalleryRecordByteIdentities,
  retainedMobileMessageByteIdentities,
} from './mobileLocalContentOwnership';
import { MobileWorkspaceContentRepository } from './mobileWorkspaceContentRepository';

/**
 * Delete project-scoped generated images through the one canonical gallery owner.
 *
 * The Shared gallery facade holds the metadata, and its repository writes the durable byte-deletion
 * journal inside the same transaction that drops the row. So this adapter never unlinks a file
 * itself: a removal that commits is already recorded for byte drain, and a removal that fails
 * leaves both the row and the bytes intact for Shared to retry at the media phase.
 *
 * That journal is an intent, not a queue of unlinks: it names the path AND which owner may act on
 * those bytes. A record that entered through Sync carries `provenance`, so its intent names the
 * Shared File owner and the drain asks that owner to release it; a locally generated record's
 * intent is settled by a local unlink. Either way the fact survives a restart, and there is still
 * exactly one byte owner per record. This adapter deliberately does nothing after a removal
 * commits: there is no second, best-effort release path to fall out of sync with the intent.
 *
 * Attachment URIs outside that gallery still do not say whether Mobile owns their bytes. The
 * retained-identity projection rejects unknown or malformed local shapes before any removal is
 * requested, so cleanup fails closed instead of orphaning or deleting a user-owned picker file.
 */
export class MobileProjectMediaCleanup implements ProjectDeletionCleanupPort {
  private readonly workspaceContent: MobileWorkspaceContentRepository;

  constructor(
    private readonly options: {
      readonly releases: MobileGeneratedImageGalleryRepository;
      readonly settle: (
        intent: GeneratedImageReleaseIntent,
        commitFence?: DeletionCleanupContinuation,
      ) => Promise<GeneratedImageReleaseSettlement>;
      readonly gallery: () => GeneratedImageGalleryFacade | undefined;
      readonly db?: DB;
    },
  ) {
    this.workspaceContent = new MobileWorkspaceContentRepository(
      options.db ?? openWorkspaceContentDatabase(),
    );
  }

  async removeProject(
    projectId: string,
    commitFence?: DeletionCleanupContinuation,
  ): Promise<void | 'fenced'> {
    const gallery = this.options.gallery();
    if (!gallery) throw new Error('Generated image gallery was not composed.');

    const snapshot = await this.workspaceContent.read();
    const conversationIds = new Set(
      snapshot.conversations
        .filter(conversation => conversation.projectId === projectId)
        .map(conversation => conversation.id),
    );

    // Project deletion unfiles its conversations; it does not delete their messages. Therefore the
    // whole canonical transcript survives and protects every byte identity it still references.
    // Validation also covers every message before any gallery removal, so an unknown local shape
    // fails closed instead of allowing a referenced file to be deleted.
    const retainedIdentities = retainedMobileMessageByteIdentities(
      snapshot.messages,
    );
    const removable = gallery
      .snapshot()
      .images.filter(
        record =>
          record.conversationId !== null &&
          conversationIds.has(record.conversationId),
      )
      .filter(record => !isRetained(record, retainedIdentities));

    const releaseScope = `project:${projectId}`;
    const removalIds = removable.map(record => record.id);
    this.options.releases.captureByteDeletionScope(
      releaseScope,
      removalIds,
      commitFence?.operationId ?? `local:${releaseScope}`,
    );
    for (const record of removable) {
      if (commitFence && !commitFence()) return 'fenced';
      const outcome = await this.options.releases.withRemovalFence({
        imageId: record.id,
        isCurrentWinner: commitFence ?? (() => true),
        work: () => gallery.remove(record.id),
      });
      if (!outcome.ok && commitFence && !commitFence()) return 'fenced';
      // A concurrent owner may already have removed the row; its release belongs to that owner.
      if (!outcome.ok && outcome.failure.kind !== 'not_found') {
        throw new Error(outcome.failure.message);
      }
    }
    if (commitFence && !commitFence()) return 'fenced';
    const settlement = await this.options.releases.drainByteDeletionsForScope(
      releaseScope,
      this.options.settle,
      commitFence,
    );
    if (settlement === 'fenced') return settlement;
  }
}

function isRetained(
  record: GeneratedImageRecord,
  retainedIdentities: ReadonlySet<string>,
): boolean {
  return [...mobileGalleryRecordByteIdentities(record)].some(identity =>
    retainedIdentities.has(identity),
  );
}
