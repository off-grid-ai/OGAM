/* eslint-disable max-lines -- One Mobile composition root supplies every platform port. */
/** Mobile composition root. Shared owns the application and domain behavior; this file supplies I/O. */
import {
  createOffGridApplication,
  createWorkspaceContentOutboxDeliveryOwner,
  modelsFailureMessage,
  observeApplicationFailures,
  type NormalizedFailure,
  type OffGridApplication,
  type OffGridPlatformPorts,
  type GeneratedImageGalleryFailure,
  type WorkspaceContentOutboxDeliveryOwner,
  type WorkspaceContentOutboxDeliveryPort,
  type DeletionCleanupContinuation,
} from '@offgrid/application';
import { generateId } from '../../utils/generateId';
import logger from '../../utils/logger';
import {
  mobileRagEmbeddings,
  mobileRagExtraction,
  mobileRagStore,
  prepareMobileRagDocument,
} from '../adapters/rag/mobileRagPorts';
import { mobileModelWorkspacePorts } from '../modelServices/workspace';
import { mobileModelEjectionPorts } from '../modelServices/ejectModelsForUser';
import { mobileModelSettingsPorts } from '../modelServices/modelSettingsPorts';
import { mobileModelActivationHostPort } from '../modelServices/modelActivationHostPort';
import { createMobileModelLibraryFacadePorts } from '../modelServices/modelLibraryFacadePorts';
import { createMobileApplicationDownloadPorts } from '../modelServices/applicationDownloadPorts';
import { createMobileModelControlPort } from '../adapters/models/modelControlCatalogPort';
import { autoSetupImageCatalogProvider } from '../autoSetupImageCatalogProvider';
import type { MobileManagedArtifactIO } from '../modelServices/modelDownloadArtifactIO';
import { modelsChatPort } from './chat';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { mobileCoreSpeechPorts } from '../adapters/speech/mobileSpeechInputPorts';
import {
  getMobileWorkspaceContentRepository,
  type MobileWorkspaceContentRepository,
} from '../adapters/workspaceContent/mobileWorkspaceContentRepository';
import { MobileProjectDeletionIntentRepository } from '../adapters/workspaceContent/mobileProjectDeletionIntentRepository';
import { MobileConversationDeletionIntentRepository } from '../adapters/workspaceContent/mobileConversationDeletionIntentRepository';
import { MobileProjectMediaCleanup } from '../adapters/workspaceContent/mobileProjectMediaCleanup';
import {
  MobileGeneratedImageGalleryRepository,
  type GeneratedImageReleaseIntent,
} from '../adapters/generated-image-gallery';
import { admitGeneratedImageRecovery } from './generatedImageRecovery';
import {
  receivedMediaRelease,
  ReceivedMediaReleaseDrainScheduler,
  type ReceivedMediaReleaseDrainPass,
} from '../sync/receivedMediaRelease';
import type { ReceivedMediaReleaseAdmissionPort } from '../sync/receivedMediaReleaseAdmission';
import { MobileReceivedMediaReleaseAdmissions } from '../adapters/sync/mobileReceivedMediaReleaseAdmissions';
import { mobileDeletionContinuationResolver } from '../adapters/sync/mobileRemoteDeletionWinner';
import {
  type MobileLocalResourcePrivacyScope,
  type MobileCanonicalImagePrivacyPort,
  type MobileOwnedDirectoryPrivacyPort,
} from '../adapters/workspaceContent/mobileLocalResourcePrivacyWorkflow';
import { MobileOwnedDirectoryPrivacy } from '../adapters/workspaceContent/mobileOwnedDirectoryPrivacy';
import { MobileCanonicalImagePrivacy } from '../adapters/workspaceContent/mobileCanonicalImagePrivacy';
type MobileApplicationExtensionPorts = Partial<
  Pick<OffGridPlatformPorts, 'sync' | 'speech' | 'automation' | 'use' | 'pro'>
> & { readonly modelDownloads?: MobileManagedArtifactIO };
export type MobileApplicationPortsFactory =
  () => MobileApplicationExtensionPorts;
let extensionPortsFactory: MobileApplicationPortsFactory | null = null;
let application: OffGridApplication | null = null;
let releaseFailureObserver: (() => void) | null = null;
/**
 * Registered once per application lifetime and passed to Shared as the `workspaceContent` platform
 * port. This is the SAME normalized SQLite repository built for milestone M4
 * (`MobileWorkspaceContentRepository` / `openWorkspaceContentDatabase`) - reused here, not rebuilt,
 * so there is exactly one Mobile-side owner of the workspace-content tables.
 *
 * As of M59 this repository also implements `WorkspaceContentOutboxRepositoryPort` (durable claim,
 * acknowledge, and failed-attempt transitions), so it satisfies Shared's
 * `createWorkspaceContentOutboxDeliveryOwner({repository, delivery, newClaimId})` unchanged.
 */
let projectDeletionIntents: MobileProjectDeletionIntentRepository | null = null;
let conversationDeletionIntents: MobileConversationDeletionIntentRepository | null =
  null;
let projectMediaCleanup: MobileProjectMediaCleanup | null = null;
let generatedImageGalleryRepository: MobileGeneratedImageGalleryRepository | null =
  null;
let releaseAdmissions: ReceivedMediaReleaseAdmissionPort | null = null;
let localResourcePrivacyDirectories: MobileOwnedDirectoryPrivacyPort | null =
  null;
let defaultLocalResourcePrivacyDirectories: MobileOwnedDirectoryPrivacyPort | null =
  null;
let canonicalImagePrivacy: MobileCanonicalImagePrivacyPort | null = null;
let localResourcePrivacyWorkflow: ReturnType<
  MobileWorkspaceContentRepository['createLocalResourcePrivacyWorkflow']
> | null = null;
/**
 * The release owner that is always available, including BEFORE the Shared root recovers deletions.
 *
 * It requires no transport and no session, so it is constructed on first use inside the same
 * startup that recovery runs in - never registered by an optional module that only comes up later.
 */
function getReleaseAdmissions(): ReceivedMediaReleaseAdmissionPort {
  releaseAdmissions ??= new MobileReceivedMediaReleaseAdmissions();
  return releaseAdmissions;
}
function getLocalResourcePrivacyWorkflow() {
  localResourcePrivacyWorkflow ??=
    getMobileWorkspaceContentRepository().createLocalResourcePrivacyWorkflow(
      () =>
        localResourcePrivacyDirectories ??
        (defaultLocalResourcePrivacyDirectories ??=
          new MobileOwnedDirectoryPrivacy(
            getGeneratedImageGalleryRepository(),
            intent => settleGeneratedImageRelease(intent).then(() => undefined),
          )),
      () =>
        (canonicalImagePrivacy ??= new MobileCanonicalImagePrivacy({
          gallery: () => getMobileApplication().generatedImages,
          repository: getGeneratedImageGalleryRepository(),
          settle: intent =>
            settleGeneratedImageRelease(intent).then(() => undefined),
        })),
      generateId,
    );
  return localResourcePrivacyWorkflow;
}

/** Read or command the one reactive Mobile local-resource privacy owner. */
export const mobileLocalResourcePrivacy = {
  getSnapshot: () => getLocalResourcePrivacyWorkflow().getSnapshot(),
  subscribe: (listener: () => void) =>
    getLocalResourcePrivacyWorkflow().subscribe(listener),
  execute: (scope: MobileLocalResourcePrivacyScope) =>
    getLocalResourcePrivacyWorkflow().execute(scope),
  retry: () => getLocalResourcePrivacyWorkflow().retry(),
};
export function withMobileWorkspaceContentDeletionFence<Result>(input: {
  entity: 'project' | 'conversation';
  entityId: string;
  isCurrentWinner: () => boolean;
  work: () => Promise<Result>;
}): Promise<Result> {
  return getMobileWorkspaceContentRepository().withDeletionCommitFence(input);
}

function getGeneratedImageGalleryRepository(): MobileGeneratedImageGalleryRepository {
  generatedImageGalleryRepository ??=
    new MobileGeneratedImageGalleryRepository();
  return generatedImageGalleryRepository;
}

/** @runtime Loaded after Pro composition to avoid a core-to-Pro import cycle. */
export function removeReceivedGalleryHolder(
  imageId: string,
  deletionOperationId: string,
) {
  return getGeneratedImageGalleryRepository().removeHolderWithReceipt({
    imageId,
    deletionOperationId,
  });
}

/** @runtime Loaded after Pro composition to avoid a core-to-Pro import cycle. */
export async function removeReceivedMessageHolder(input: {
  readonly messageId: string;
  readonly deletionOperationId: string;
  readonly syncId: string;
  readonly expectedRevision: string;
  readonly expectedPreimage:
    | import('@offgrid/application').MessageRecord['local']
    | null;
}) {
  const receipt =
    await getMobileWorkspaceContentRepository().removeMessageHolderWithReceipt(
      input,
    );
  const refreshed = await getMobileApplication().workspaceContent.refresh();
  if (!refreshed.ok) throw new Error(refreshed.failure.message);
  return receipt;
}

/**
 * Settle one durable release intent through the owner it names.
 *
 * The intent, not the (already deleted) record, decides who acts: a locally generated image is
 * unlinked here through the native store, and a received image is handed to the Shared File owner,
 * which stays the sole owner of provenance bytes. Either path THROWS on failure, and the repository
 * only drops an intent once this resolves - so a missing owner, a busy file, or a crash leaves the
 * path and its provenance on disk for the next attempt, and the failure travels up to the Shared
 * deletion workflow's media phase.
 */
async function settleGeneratedImageRelease(
  intent: GeneratedImageReleaseIntent,
  commitFence?: DeletionCleanupContinuation,
): Promise<void | 'fenced'> {
  if (commitFence && !commitFence()) return 'fenced';
  if (intent.owner === 'provenance') {
    const owner = receivedMediaRelease();
    if (!owner) {
      // Startup order, not an error: the Shared File session that installs the owner can only
      // start once the application is running, and this runs inside the root's own deletion
      // recovery. Settle the release the only way that is honest without a transport - a durable
      // local tombstone - and let the post-running drain hand it to the owner. `admit` resolves
      // only when the row is proven persisted, so nothing is dropped on a void write.
      await getReleaseAdmissions().admit({
        id: intent.id,
        path: intent.path,
        authority: commitFence ? 'remote_conditional' : 'local_unconditional',
        ...(commitFence
          ? {
              continuation: {
                operationId: commitFence.operationId,
                entity: commitFence.entity,
                entityId: commitFence.entityId,
                expectedWinner: commitFence.expectedWinner,
                phase: commitFence.phase,
              },
            }
          : {}),
      });
      // Close the race where Pro installs between the owner check and the durable admission.
      requestReceivedMediaReleaseAdmissionDrain();
      return;
    }
    // `already_released` is the owner's proof that there is nothing left to release - no durable
    // record claims the bytes AND the confined file is gone - so the intent is settled and drops.
    // `not_owned` means ownership is unknown while bytes may still exist, which stays a durable
    // failure so the deletion workflow retries rather than orphaning a file.
    const outcome = await owner.release({ path: intent.path }, commitFence);
    if (outcome === 'fenced') return 'fenced';
    if (outcome === 'not_owned') {
      throw new Error(
        `No received record claims the bytes of image ${intent.id}.`,
      );
    }
    return;
  }
  const { localDreamGeneratorService } =
    require('../localDreamGenerator') as typeof import('../localDreamGenerator');
  // `deleted` and `already_missing` are BOTH settled: the intent asks for no bytes at that path,
  // and a retry after a crash between the unlink and the journal ack finds the file already gone.
  // Only `failure` - permission, busy, I/O, no native store - keeps the intent for the next attempt.
  const outcome = await localDreamGeneratorService.deleteGeneratedImage(
    intent.path,
    commitFence,
  );
  if (outcome.status === 'fenced') return 'fenced';
  if (outcome.status === 'failure') {
    throw new Error(
      `Native image ${intent.id} could not be deleted (${outcome.code}: ${outcome.message}).`,
    );
  }
}

async function deliverReleaseAdmissions(): Promise<ReceivedMediaReleaseDrainPass> {
  const admissions = getReleaseAdmissions();
  const owner = receivedMediaRelease();
  if (!owner) return 'owner_absent';
  const failures: unknown[] = [];
  let retry = false;
  for (const admission of await admissions.pending()) {
    try {
      if (admission.authority === 'legacy_unknown') {
        retry = true;
        continue;
      }
      let continuation: DeletionCleanupContinuation | undefined;
      if (admission.authority === 'remote_conditional') {
        if (!admission.continuation) {
          retry = true;
          continue;
        }
        const resolution = await mobileDeletionContinuationResolver.resolve({
          entity: admission.continuation.entity,
          entityId: admission.continuation.entityId,
          remoteOperationId: admission.continuation.operationId,
        });
        if (resolution.status === 'not_ready') {
          retry = true;
          continue;
        }
        if (resolution.status === 'superseded') {
          await admissions.settle(admission.id);
          continue;
        }
        const current = () =>
          resolution.continuation.isCurrent(admission.continuation!.phase);
        continuation = Object.freeze(
          Object.assign(current, {
            operationId: admission.continuation.operationId,
            entity: admission.continuation.entity,
            entityId: admission.continuation.entityId,
            expectedWinner: admission.continuation.expectedWinner,
            phase: admission.continuation.phase,
            winnerIsCurrent: current,
          }),
        );
      }
      const outcome = await owner.release(
        { path: admission.path },
        continuation,
      );
      if (outcome === 'not_owned') {
        retry = true;
        continue;
      }
      await admissions.settle(admission.id);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0)
    throw new Error(
      `${failures.length} provenance release admission(s) did not settle`,
    );
  return retry ? 'retry' : 'settled';
}

const releaseAdmissionDrain = new ReceivedMediaReleaseDrainScheduler(
  deliverReleaseAdmissions,
  error =>
    logger.error('[Application] Provenance release delivery failed', error),
);
export function requestReceivedMediaReleaseAdmissionDrain(): void {
  releaseAdmissionDrain.request();
}
async function drainGeneratedImageBytesForScope(
  scope: string,
  continuation?: DeletionCleanupContinuation,
): Promise<void> {
  await getGeneratedImageGalleryRepository().drainByteDeletionsForScope(
    scope,
    settleGeneratedImageRelease,
    continuation,
  );
}

class MobileGeneratedImageRemovalError extends Error {
  constructor(readonly failure: GeneratedImageGalleryFailure) {
    super(failure.message);
    this.name = 'MobileGeneratedImageRemovalError';
  }
}

export async function removeGeneratedImage(id: string): Promise<void> {
  const gallery = getMobileApplication().generatedImages;
  if (!gallery) throw new Error('Generated image gallery was not composed.');
  const releaseScope = `gallery-delete:${id}`;
  getGeneratedImageGalleryRepository().captureByteDeletionScope(
    releaseScope,
    [id],
    generateId(),
  );
  const outcome = await gallery.remove(id);
  if (!outcome.ok && outcome.failure.kind !== 'not_found') {
    throw new MobileGeneratedImageRemovalError(outcome.failure);
  }
  await drainGeneratedImageBytesForScope(releaseScope);
}

/** Bind Pro's transport to the same repository used by the root Workspace Content facade. */
export function createMobileWorkspaceContentOutboxOwner(
  delivery: WorkspaceContentOutboxDeliveryPort,
): WorkspaceContentOutboxDeliveryOwner {
  return createWorkspaceContentOutboxDeliveryOwner({
    repository: getMobileWorkspaceContentRepository(),
    delivery,
    newClaimId: generateId,
  });
}

function getProjectDeletionRecovery(): NonNullable<
  OffGridPlatformPorts['projectDeletionRecovery']
> {
  projectDeletionIntents ??= new MobileProjectDeletionIntentRepository();
  projectMediaCleanup ??= new MobileProjectMediaCleanup({
    releases: getGeneratedImageGalleryRepository(),
    settle: settleGeneratedImageRelease,
    gallery: () => getMobileApplication().generatedImages,
  });
  conversationDeletionIntents ??=
    new MobileConversationDeletionIntentRepository();
  return {
    intents: projectDeletionIntents,
    media: projectMediaCleanup,
    deletionContinuationResolver: mobileDeletionContinuationResolver,
    now: () => new Date().toISOString(),
    conversations: {
      intents: conversationDeletionIntents,
      captureImageReleaseScope: async (scope, imageIds, continuation) => {
        getGeneratedImageGalleryRepository().captureByteDeletionScope(
          scope,
          imageIds,
          continuation?.operationId ?? `local:${scope}`,
        );
      },
      settleImageBytes: drainGeneratedImageBytesForScope,
      now: () => new Date().toISOString(),
      deletionContinuationResolver: mobileDeletionContinuationResolver,
    },
  };
}

/**
 * The ONLY thing this app still owns about failure reporting: where the line goes.
 *
 * Everything else - which streams carry failures, the four events whose failure is a status or an
 * outcome rather than a field, each domain's correlation identity, the amplification cap and the
 * exhaustiveness that stops a new failure event being dropped - is `@offgrid/application`'s, and is
 * now shared with desktop instead of written twice. This replaced 358 lines here.
 */
const writeFailure = (failure: NormalizedFailure): void => {
  logger.error(`[${failure.domain}] ${failure.summary}`, {
    ...failure.fields,
    event: failure.event,
    operation: failure.operation,
    identity: failure.identity,
    identityKind: failure.identityKind,
  });
};

/**
 * Kept ALONGSIDE the observer, deliberately, and not a duplicate of it: the domains the app
 * composed no ports for are recorded at construction as `unavailable` reports and emit NO event, so
 * they reach `result.degraded` and nothing else. One summary line rather than one error per entry,
 * because everything in here that IS a failure is already reported per event by the observer.
 */
function reportDegradedStart(
  result: Awaited<ReturnType<OffGridApplication['start']>>,
): Awaited<ReturnType<OffGridApplication['start']>> {
  if (result.degraded.length > 0) {
    logger.warn('[Application] Domains running but not whole', {
      degraded: result.degraded.map(
        ({ domain, source, reason }) => `${domain} (${source}): ${reason}`,
      ),
    });
  }
  return result;
}

/** Register optional paid-domain ports before any consumer starts the application. */
export function registerMobileApplicationPorts(
  factory: MobileApplicationPortsFactory,
): void {
  if (extensionPortsFactory === factory) return;
  if (application) {
    throw new Error(
      'Mobile application ports must be registered before application startup.',
    );
  }
  extensionPortsFactory = factory;
}

function createMobileApplication(): OffGridApplication {
  const { modelDownloads, ...extensionPorts } = extensionPortsFactory?.() ?? {};
  return createOffGridApplication({
    models: {
      // The workspace's own I/O, not a workspace: shared composes the single one from these. See
      // `mobileModelWorkspacePorts` for why this app no longer holds the instance.
      ...mobileModelWorkspacePorts,
      chat: modelsChatPort,
      ejection: mobileModelEjectionPorts(),
      library: createMobileModelLibraryFacadePorts(modelDownloads),
      downloads: createMobileApplicationDownloadPorts(modelDownloads),
      control: createMobileModelControlPort(() =>
        autoSetupImageCatalogProvider.load(),
      ),
      settings: mobileModelSettingsPorts,
      activation: mobileModelActivationHostPort,
    },
    rag: {
      store: mobileRagStore,
      embeddings: mobileRagEmbeddings,
      extraction: mobileRagExtraction,
      prepareDocument: prepareMobileRagDocument,
    },
    speech: mobileCoreSpeechPorts,
    // Shared's root application composes the WorkspaceContentFacade from this repository port.
    // See `shared/packages/application/src/contracts/platform-ports.ts` (`workspaceContent?:
    // WorkspaceContentPlatformPorts`, an alias of `WorkspaceContentRepositoryPort`) and
    // `OffGridApplication.workspaceContent` in `contracts/application.ts`. That root-level
    // construction is a parallel Shared worker's milestone, not this file's - this is only the
    // Mobile-side registration of the port.
    workspaceContent: getMobileWorkspaceContentRepository(),
    generatedImageGallery: getGeneratedImageGalleryRepository(),
    ...extensionPorts,
    projectDeletionRecovery: getProjectDeletionRecovery(),
    newId: generateId,
  });
}

export function getMobileApplication(): OffGridApplication {
  application ??= createMobileApplication();
  releaseFailureObserver ??= observeApplicationFailures(
    application,
    writeFailure,
  );
  return application;
}

let starting: ReturnType<OffGridApplication['start']> | null = null;

function mobileModelServices(): Pick<
  typeof import('../modelServices'),
  'startMobileModelServices' | 'stopMobileModelServices'
> {
  // Deferred because modelServices resolves this composition root through applicationFacade().
  // getMobileApplication() has created the root before this function is called, so both sides use
  // the same application instead of depending on an App.tsx import side effect.
  return require('../modelServices') as typeof import('../modelServices');
}

/**
 * Recover the durable download journal once per application lifetime.
 *
 * A download interrupted by an app kill is only re-observed when something calls the PUBLIC
 * inventory refresh: shared's `refresh` awaits its own private `hydrateDownloads()` before
 * reconciling (`packages/application/src/models/projector-repair-facade.ts`). Hydration is a
 * durable-recovery concern for the whole app lifetime, so the STARTUP LIFECYCLE owns it here -
 * not a component effect, which would tie recovery to a render tree.
 *
 * Deliberately NOT awaited by `startMobileApplication`. It reads the native download database,
 * which contends with in-flight writes, and the first screen must never wait on it.
 *
 * A refusal is reported, never dropped: the domain emits its own typed failure event (which the
 * failure observer writes), and this adds the one fact the event cannot carry - that the missing
 * work was cold-start recovery - as a late degradation on the snapshot, cleared on success so a
 * later retry is not shadowed by a stale entry.
 */
function recoverDownloadJournal(current: OffGridApplication): void {
  const report = (reason: string | null) =>
    current.reportDegraded({
      domain: 'models',
      source: 'download recovery',
      reason,
    });
  current.models
    .refresh()
    .then(outcome => {
      if (outcome.ok) return report(null);
      logger.error(
        '[Application] Cold-start download recovery failed',
        outcome.failure,
      );
      report(modelsFailureMessage(outcome.failure));
    })
    .catch(error => {
      logger.error('[Application] Cold-start download recovery threw', error);
      report(error instanceof Error ? error.message : String(error));
    });
}

/**
 * Project-deletion recovery is NOT coordinated here.
 *
 * `@offgrid/application`'s root runs both durable deletion recoveries inside its own start lifetime
 * and is the sole coordinator. This file supplies the intent and cleanup ports only.
 *
 * A second call from here was a duplicate coordinator: it re-read the intent set AFTER the root had
 * already settled it, so a resumed deletion could be observed twice and this consumer held its own
 * opinion about recovery lifecycle state. The root reports for itself - an absent port is a
 * successful no-op, and a configured port's real failure emits `workflow_failed` (written by the
 * failure observer) and throws out of `start()`, which the catch below logs and re-raises.
 */

export function startMobileApplication(): ReturnType<
  OffGridApplication['start']
> {
  const current = getMobileApplication();
  starting ??= (async () => {
    const modelServices = mobileModelServices();
    modelServices.startMobileModelServices();
    try {
      const result = await current.start();
      if (result.status !== 'running') {
        throw new Error(result.message);
      }
      await getLocalResourcePrivacyWorkflow().start();
      await getMobileWorkspaceContentRepository().localResourceReleases.start();
      await admitGeneratedImageRecovery({
        application: current,
        repository: getGeneratedImageGalleryRepository(),
        settle: intent =>
          settleGeneratedImageRelease(intent).then(() => undefined),
      });
      await callHook<Promise<void>>(HOOKS.applicationStarted);
      requestReceivedMediaReleaseAdmissionDrain();
      recoverDownloadJournal(current);
      return reportDegradedStart(result);
    } catch (error) {
      modelServices.stopMobileModelServices();
      logger.error('[Application] Startup failed', error);
      throw error;
    }
  })();
  return starting;
}

export async function stopMobileApplication(): Promise<void> {
  try {
    await callHook<Promise<void>>(HOOKS.applicationStopping);
    await getMobileWorkspaceContentRepository().localResourceReleases.stop();
    mobileModelServices().stopMobileModelServices();
    await application?.stop();
  } finally {
    // Releasing the subscription drops the amplification cap with it, so a new session starts
    // counting from zero without this file owning a reset.
    releaseFailureObserver?.();
    releaseFailureObserver = null;
    starting = null;
    // The memo must never outlive the application it holds. `stop()` is terminal - a stopped
    // download coordinator refuses every later call - so keeping the instance here handed the next
    // `getMobileApplication()` a dead root that no `start()` could revive. Dropping it restores the
    // module invariant: the memo either holds a live application or holds nothing.
    application = null;
  }
}

/**
 * Stop the running application and compose a fresh one.
 *
 * The lifecycle completion of `start`/`stop`: `stop()` is terminal, so any caller that must run the
 * app again after tearing it down - a session or workspace change, a recovery from a failed start,
 * a re-registration of extension ports - needs a NEW root, and only the module that owns the memo
 * can supply one. Returns the fresh application so the caller never re-resolves a stale reference.
 */
export async function resetMobileApplication(): Promise<OffGridApplication> {
  await stopMobileApplication();
  return getMobileApplication();
}
