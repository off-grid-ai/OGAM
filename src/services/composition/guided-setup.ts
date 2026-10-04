import {
  createGuidedSetupSession,
  guidedSetupDownloadId,
  guidedSetupTierFromLoadingMode,
  guidedSetupTierToLoadingMode,
  type GuidedSetupCandidate,
  type GuidedSetupDownloadProjection,
  type GuidedSetupSession,
  type GuidedSetupTierPlan,
} from '@offgrid/models';
import type { ModelDownloadStartRequest } from '../modelServices/downloadTypes';
import { modelsFailureMessage } from '@offgrid/application';
import {
  loadAutoSetupCompatibleCatalog,
  type AutoSetupImagePayload,
  type AutoSetupSttPayload,
  type AutoSetupTextPayload,
  type AutoSetupCatalogBoundaries,
} from '../autoSetupCatalog';
import { applicationFacade } from '../applicationFacade';
import { makeModelKey } from '../../utils/modelKey';
import { mobileImageDownloadSelection } from '../adapters/models/modelControlCatalogPort';
import { mobileTextDownloadRequest } from '../modelServices/modelDownloadRequests';
import { publicImageDownloadRequest } from '../adapters/models/downloads/publicImageDownloadRequest';
import { downloadTranscriptionModel } from '../transcriptionModelApplication';

interface AutoSetupDownloadBoundaries {
  start: (request: ModelDownloadStartRequest) => Promise<void>;
  list: () => Promise<GuidedSetupDownloadProjection[]>;
  cancel: (id: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

function controlRequest(request: ModelDownloadStartRequest) {
  if (request.modelType === 'text') {
    const metadataJson = mobileTextDownloadRequest(
      request.modelId,
      request.file,
    ).metadataJson;
    return {
      modelId: makeModelKey(request.modelId, request.file.name),
      selection: {
        repositoryId: request.modelId,
        fileName: request.file.name,
        ...(metadataJson ? { metadataJson } : {}),
      },
    };
  }
  if (request.modelType === 'image') {
    const selection = mobileImageDownloadSelection(request.model);
    if (!selection) throw new Error('The image model source is incomplete.');
    const metadataJson = publicImageDownloadRequest(request.model).metadataJson;
    return {
      modelId: `image:${request.model.id}`,
      selection: { ...selection, ...(metadataJson ? { metadataJson } : {}) },
    };
  }
  return null;
}

const productionDownloads: AutoSetupDownloadBoundaries = {
  async start(request) {
    // Transcription downloads have exactly one owner: the shared Whisper download
    // request (createWhisperPublicDownloadRequest), reached through the transcription
    // application service. Nothing here re-invents the whisper download identity.
    if (request.modelType !== 'text' && request.modelType !== 'image') {
      const queued = await downloadTranscriptionModel(request.modelId);
      if (!queued.ok) throw new Error(modelsFailureMessage(queued.failure));
      return;
    }
    const selected = controlRequest(request);
    if (!selected) throw new Error('The model download source is incomplete.');
    const outcome = await applicationFacade().models.control({
      type: 'queue-download',
      ...selected,
    });
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  },
  list: async () =>
    applicationFacade()
      .models.snapshot()
      .control.downloads.map(row => ({
        id: guidedSetupDownloadId({
          kind: row.modelType ?? 'text',
          id: row.modelId,
        }),
        status: row.status,
        progress: row.totalBytes > 0 ? row.bytesDownloaded / row.totalBytes : 0,
        ...(row.reason ? { error: row.reason } : {}),
      })),
  async cancel(id) {
    const row = applicationFacade()
      .models.snapshot()
      .control.downloads.find(
        candidate =>
          guidedSetupDownloadId({
            kind: candidate.modelType ?? 'text',
            id: candidate.modelId,
          }) === id,
      );
    if (!row) return;
    const outcome = await applicationFacade().models.control({
      type: 'cancel-download',
      modelId: row.downloadId,
    });
    if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
  },
  subscribe: listener =>
    applicationFacade().models.watch(
      snapshot => snapshot.control.downloads,
      listener,
    ),
};

export type AutoSetupSession = GuidedSetupSession<
  AutoSetupTextPayload,
  AutoSetupImagePayload,
  AutoSetupSttPayload,
  never
>;
export type AutoSetupPlan = GuidedSetupTierPlan<
  AutoSetupTextPayload,
  AutoSetupImagePayload,
  AutoSetupSttPayload,
  never
>;

export interface AutoSetupSessionBoundaries {
  catalog?: AutoSetupCatalogBoundaries;
  downloads?: AutoSetupDownloadBoundaries;
  catalogDeadlineMs?: number;
}

type SetupPayload =
  | AutoSetupTextPayload
  | AutoSetupImagePayload
  | AutoSetupSttPayload;

function toDownloadRequest(
  item: GuidedSetupCandidate<SetupPayload>,
): ModelDownloadStartRequest {
  if (item.kind === 'text') {
    const payload = item.payload as AutoSetupTextPayload;
    return { modelType: 'text', modelId: payload.modelId, file: payload.file };
  }
  if (item.kind === 'image') {
    return { modelType: 'image', model: item.payload as AutoSetupImagePayload };
  }
  return {
    modelType: 'stt',
    modelId: (item.payload as AutoSetupSttPayload).modelId,
  };
}

/** Composition root: shared owns the complete Auto Setup use case; these are Mobile's ports. */
export function createAutoSetupSession(
  boundaries: AutoSetupSessionBoundaries = {},
): AutoSetupSession {
  const downloads = boundaries.downloads ?? productionDownloads;
  return createGuidedSetupSession({
    loadCatalog: () => loadAutoSetupCompatibleCatalog(boundaries.catalog),
    listDownloads: () => downloads.list(),
    startDownload: item => downloads.start(toDownloadRequest(item)),
    cancelDownload: id => downloads.cancel(id),
    subscribeDownloads: listener => downloads.subscribe(listener),
    loadTier: () => {
      const mode =
        applicationFacade().models.snapshot().settings.modelLoadingMode;
      return guidedSetupTierFromLoadingMode(
        typeof mode === 'string' ? mode : undefined,
      );
    },
    saveTier: async tier => {
      const outcome = await applicationFacade().models.settings.save({
        patch: { modelLoadingMode: guidedSetupTierToLoadingMode(tier) },
        origin: 'local',
      });
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    },
    activate: async item => {
      if (item.kind !== 'text') return;
      const outcome = await applicationFacade().models.control({
        type: 'activate',
        surface: 'text',
        modelId: item.id,
      });
      if (!outcome.ok) throw new Error(modelsFailureMessage(outcome.failure));
    },
    catalogDeadlineMs: boundaries.catalogDeadlineMs,
  });
}
