import { modelDownloadService } from './modelDownloadService';
import type { ModelDownload, ModelDownloadStartRequest } from './modelDownloadService/types';
import { useAppStore } from '../stores';
import { activeModelService } from './activeModelService';
import { uniformDownloadId } from './modelDownloadService/uniformId';
import { embeddingService } from './rag/embedding';
import {
  loadAutoSetupCompatibleCatalog,
  type AutoSetupCatalogBoundaries,
} from './autoSetupCatalog';
import {
  selectAutoSetupPlans,
  type AutoSetupEmbeddingModel,
  type AutoSetupItem,
  type AutoSetupModelKind,
  type AutoSetupPlan,
  type AutoSetupTier,
} from './autoSetupPlan';

export interface AutoSetupDownloadBoundaries {
  start: (request: ModelDownloadStartRequest) => Promise<void>;
  list: () => Promise<ModelDownload[]>;
  cancel: (id: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

export interface AutoSetupEmbeddingBoundaries {
  isDownloaded: (model: AutoSetupEmbeddingModel) => Promise<boolean>;
  start: (model: AutoSetupEmbeddingModel, progress: (fraction: number) => void, signal: AbortSignal) => Promise<void>;
}

const productionDownloadBoundaries: AutoSetupDownloadBoundaries = {
  start: request => modelDownloadService.start(request),
  list: () => modelDownloadService.list(),
  cancel: id => modelDownloadService.cancel(id),
  subscribe: listener => modelDownloadService.subscribe(listener),
};

const productionEmbeddingBoundaries: AutoSetupEmbeddingBoundaries = {
  isDownloaded: model => model.size === 0
    ? Promise.resolve(true)
    : embeddingService.isModelDownloaded(model),
  async start(model, progress, signal) {
    if (!model.downloadUrl) throw new Error('This embedding model has no download file.');
    await embeddingService.downloadModel(
      { ...model, downloadUrl: model.downloadUrl },
      () => undefined,
      signal,
      progress,
    );
  },
};

type AutoSetupItemPhase =
  | 'waiting'
  | 'starting'
  | 'downloading'
  | 'completed'
  | 'failed'
  | 'cancelled';

interface AutoSetupItemOutcome {
  id: string;
  phase: AutoSetupItemPhase;
  progress: number;
  error?: string;
}

interface AutoSetupSnapshot {
  phase: 'loading_catalog' | 'ready' | 'downloading' | 'completed' | 'failed';
  plans: AutoSetupPlan[];
  selectedTier: AutoSetupTier;
  selectedKinds: AutoSetupModelKind[];
  installedIds: string[];
  outcomes: Record<string, AutoSetupItemOutcome>;
  error: string | null;
}

export interface AutoSetupSession {
  snapshot(): AutoSetupSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  selectTier(tier: AutoSetupTier): void;
  toggleKind(kind: AutoSetupModelKind): void;
  start(): Promise<void>;
  cancel(): Promise<void>;
  complete(): void;
  dispose(): void;
}

export interface AutoSetupSessionBoundaries {
  catalog?: AutoSetupCatalogBoundaries;
  downloads?: AutoSetupDownloadBoundaries;
  embedding?: AutoSetupEmbeddingBoundaries;
  catalogDeadlineMs?: number;
}

const DEFAULT_CATALOG_DEADLINE_MS = 15_000;
function tierFromPersistedIntent(): AutoSetupTier {
  const mode = useAppStore.getState().settings.modelLoadingMode;
  if (mode === 'conservative') return 'lean';
  if (mode === 'aggressive') return 'extreme';
  return 'balanced';
}

export function autoSetupDownloadId(
  item: AutoSetupItem,
): string {
  if (item.kind === 'embedding') return `embedding:${item.id}`;
  return uniformDownloadId(item.kind, item.id);
}

export function autoSetupItemNeedsAction(
  item: AutoSetupItem,
  installedIds: readonly string[],
): boolean {
  return item.kind !== 'embedding' || (
    item.sizeBytes > 0 && !installedIds.includes(autoSetupDownloadId(item))
  );
}

function message(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message;
  }
  return 'Unknown error';
}

function initialOutcomes(
  items: AutoSetupItem[],
): Record<string, AutoSetupItemOutcome> {
  return Object.fromEntries(
    items.map(item => {
      const id = autoSetupDownloadId(item);
      return [id, { id, phase: 'waiting', progress: 0 }];
    }),
  );
}

function downloadPhase(status: ModelDownload['status']): AutoSetupItemPhase {
  if (status === 'completed') return 'completed';
  if (status === 'error') return 'failed';
  return 'downloading';
}

interface DownloadRefreshProjection {
  outcomes: Record<string, AutoSetupItemOutcome>;
  failure?: AutoSetupItemOutcome;
  allCompleted: boolean;
}

function projectActiveDownloads(
  activeIds: ReadonlySet<string>,
  listed: ModelDownload[],
  currentOutcomes: Record<string, AutoSetupItemOutcome>,
): DownloadRefreshProjection {
  const byId = new Map(listed.map(download => [download.id, download]));
  const outcomes = { ...currentOutcomes };
  let failure: AutoSetupItemOutcome | undefined;
  let allCompleted = activeIds.size > 0;

  for (const id of activeIds) {
    const download = byId.get(id);
    const current = outcomes[id] ?? { id, phase: 'starting', progress: 0 };
    const outcome: AutoSetupItemOutcome = download
      ? {
          id,
          phase: downloadPhase(download.status),
          progress: download.progress,
          ...(download.error ? { error: download.error } : {}),
        }
      : current;
    outcomes[id] = outcome;
    if (outcome.phase === 'failed') failure = outcome;
    allCompleted =
      allCompleted && download !== undefined && outcome.phase === 'completed';
  }

  return { outcomes, failure, allCompleted };
}

/** One owner for the complete Auto Setup lifecycle. The screen only renders this projection. */
export function createAutoSetupSession(
  boundaries: AutoSetupSessionBoundaries = {},
): AutoSetupSession {
  const downloads = boundaries.downloads ?? productionDownloadBoundaries;
  const embedding = boundaries.embedding ?? productionEmbeddingBoundaries;
  const listeners = new Set<() => void>();
  const activeIds = new Set<string>();
  let pendingEmbeddingId: string | null = null;
  let embeddingAbort: AbortController | null = null;
  let disposed = false;
  let operation = 0;
  let refreshInFlight = false;
  let state: AutoSetupSnapshot = {
    phase: 'loading_catalog',
    plans: [],
    selectedTier: tierFromPersistedIntent(),
    selectedKinds: ['text'],
    installedIds: [],
    outcomes: {},
    error: null,
  };

  const publish = (patch: Partial<AutoSetupSnapshot>): void => {
    if (disposed) return;
    state = { ...state, ...patch };
    listeners.forEach(listener => listener());
  };

  const selectedPlan = (): AutoSetupPlan | undefined =>
    state.plans.find(plan => plan.tier === state.selectedTier) ??
    state.plans[0];
  const selectedItems = (plan: AutoSetupPlan) =>
    [...plan.items, ...(plan.embedding ? [plan.embedding] : [])]
      .filter(item => state.selectedKinds.includes(item.kind) &&
        autoSetupItemNeedsAction(item, state.installedIds));

  const stopActive = async (cancelled: boolean): Promise<void> => {
    const ids = [...activeIds, ...(pendingEmbeddingId ? [pendingEmbeddingId] : [])];
    activeIds.clear();
    pendingEmbeddingId = null;
    embeddingAbort?.abort();
    embeddingAbort = null;
    await Promise.allSettled(ids.filter(id => !id.startsWith('embedding:')).map(id => downloads.cancel(id)));
    if (cancelled && !disposed) {
      const outcomes = { ...state.outcomes };
      for (const id of ids) {
        const current = outcomes[id];
        if (current && current.phase !== 'completed' && current.phase !== 'failed') {
          outcomes[id] = { ...current, phase: 'cancelled' };
        }
      }
      publish({ outcomes });
    }
  };

  const refreshDownloads = async (): Promise<void> => {
    if (disposed || refreshInFlight || activeIds.size === 0) return;
    const token = operation;
    refreshInFlight = true;
    try {
      const listed = await downloads.list();
      if (disposed || token !== operation) return;
      const { outcomes, failure, allCompleted } = projectActiveDownloads(
        activeIds,
        listed,
        state.outcomes,
      );
      publish({
        outcomes,
        installedIds: [
          ...state.installedIds.filter(id => id.startsWith('embedding:')),
          ...listed.filter(download => download.status === 'completed').map(download => download.id),
        ],
      });
      if (failure) {
        operation += 1;
        await stopActive(true);
        publish({
          phase: 'failed',
          error: failure.error ?? 'A model download failed. Try again.',
        });
      } else if (allCompleted) {
        activeIds.clear();
        if (!pendingEmbeddingId) publish({ phase: 'completed', error: null });
      }
    } catch (error) {
      if (!disposed && token === operation) {
        operation += 1;
        await stopActive(true);
        publish({ phase: 'failed', error: message(error) });
      }
    } finally {
      refreshInFlight = false;
    }
  };

  const unsubscribeDownloads = downloads.subscribe(() => {
    refreshDownloads().catch(() => undefined);
  });

  const load = async (): Promise<void> => {
    const token = ++operation;
    publish({ phase: 'loading_catalog', error: null });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const catalog = await Promise.race([
        loadAutoSetupCompatibleCatalog(boundaries.catalog),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new Error('The model catalog did not respond in time.')),
            boundaries.catalogDeadlineMs ?? DEFAULT_CATALOG_DEADLINE_MS,
          );
        }),
      ]);
      if (disposed || token !== operation) return;
      const plans = selectAutoSetupPlans(catalog);
      const installed = await downloads.list().catch(() => []);
      const embeddingItems = [...new Map(plans.flatMap(plan =>
        plan.embedding ? [[plan.embedding.id, plan.embedding] as const] : [],
      )).values()];
      const installedEmbedding = await Promise.all(embeddingItems.map(async item =>
        await embedding.isDownloaded(item.payload).catch(() => false)
          ? autoSetupDownloadId(item) : null,
      ));
      if (disposed || token !== operation) return;
      publish({
        phase: 'ready',
        plans,
        installedIds: [
          ...installed.filter(download => download.status === 'completed').map(download => download.id),
          ...installedEmbedding.filter((id): id is string => id !== null),
        ],
        error: null,
      });
    } catch (error) {
      if (disposed || token !== operation) return;
      publish({
        phase: 'failed',
        error: message(error) || 'Auto Setup could not load the model catalog.',
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const startEmbeddingDownload = (
    item: NonNullable<AutoSetupPlan['embedding']>,
    token: number,
  ): void => {
    const id = autoSetupDownloadId(item);
    const controller = new AbortController();
    embeddingAbort = controller;
    embedding.start(item.payload, fraction => {
      if (disposed || token !== operation) return;
      publish({ outcomes: {
        ...state.outcomes,
        [id]: { id, phase: 'downloading', progress: Math.max(0, Math.min(1, fraction)) },
      } });
    }, controller.signal).then(() => {
      if (disposed || token !== operation) return;
      pendingEmbeddingId = null;
      embeddingAbort = null;
      publish({
        outcomes: { ...state.outcomes, [id]: { id, phase: 'completed', progress: 1 } },
        installedIds: [...new Set([...state.installedIds, id])],
        ...(activeIds.size === 0 ? { phase: 'completed' as const } : {}),
      });
    }).catch(async error => {
      if (disposed || token !== operation) return;
      operation += 1;
      await stopActive(true);
      publish({
        phase: 'failed',
        outcomes: { ...state.outcomes, [id]: { id, phase: 'failed', progress: 0, error: message(error) } },
        error: message(error),
      });
    });
  };

  const prepareSelectedDownloads = async (
    plan: AutoSetupPlan,
    items: AutoSetupItem[],
    token: number,
  ): Promise<boolean> => {
    let existing: ModelDownload[];
    try {
      existing = await downloads.list();
    } catch (error) {
      if (!disposed && token === operation)
        publish({ phase: 'failed', error: message(error) });
      return false;
    }
    if (disposed || token !== operation) return false;
    const completedIds = new Set(
      existing
        .filter(download => download.status === 'completed')
        .map(download => download.id),
    );
    const embeddingItem = plan.embedding && state.selectedKinds.includes('embedding')
      ? plan.embedding : undefined;
    const selectedEmbeddingId = embeddingItem ? autoSetupDownloadId(embeddingItem) : null;
    if (embeddingItem && await embedding.isDownloaded(embeddingItem.payload).catch(() => false))
      completedIds.add(autoSetupDownloadId(embeddingItem));
    if (disposed || token !== operation) return false;
    publish({ installedIds: [
      ...state.installedIds.filter(id => id.startsWith('embedding:') && id !== selectedEmbeddingId),
      ...completedIds,
    ] });
    const outcomes = initialOutcomes(items);
    for (const item of items) {
      const id = autoSetupDownloadId(item);
      if (completedIds.has(id))
        outcomes[id] = { id, phase: 'completed', progress: 1 };
      else {
        outcomes[id] = { id, phase: 'starting', progress: 0 };
        if (item.kind === 'embedding') pendingEmbeddingId = id;
        else activeIds.add(id);
      }
    }
    publish({
      phase: activeIds.size || pendingEmbeddingId ? 'downloading' : 'completed',
      outcomes,
      error: null,
    });
    return true;
  };

  const start = async (): Promise<void> => {
    const plan = selectedPlan();
    if (!plan || disposed) return;
    const items = selectedItems(plan);
    if (items.length === 0) return;
    const token = ++operation;
    publish({ phase: 'downloading', error: null });
    await stopActive(false);
    if (!await prepareSelectedDownloads(plan, items, token)) return;
    if (!activeIds.size && !pendingEmbeddingId) return;

    const embeddingItem = plan.embedding && state.selectedKinds.includes('embedding')
      ? plan.embedding : undefined;
    if (pendingEmbeddingId && embeddingItem) startEmbeddingDownload(embeddingItem, token);

    if (activeIds.size === 0) return;

    const [text, image, stt, video] = plan.items;
    const jobs = [
      {
        id: autoSetupDownloadId(text),
        run: () => downloads.start({ modelType: 'text', modelId: text.payload.modelId, file: text.payload.file }),
      },
      {
        id: autoSetupDownloadId(image),
        run: () => downloads.start({ modelType: 'image', model: image.payload }),
      },
      {
        id: autoSetupDownloadId(stt),
        run: () => downloads.start({ modelType: 'stt', modelId: stt.payload.modelId }),
      },
      ...(video ? [{
        id: autoSetupDownloadId(video),
        run: () => downloads.start({ modelType: 'video', model: video.payload }),
      }] : []),
    ].filter(job => activeIds.has(job.id));
    const starts = await Promise.allSettled(jobs.map(job => job.run()));
    if (disposed || token !== operation) return;
    const failedIndex = starts.findIndex(
      result => result.status === 'rejected',
    );
    if (failedIndex >= 0) {
      const id = jobs[failedIndex].id;
      const failure = starts[failedIndex] as PromiseRejectedResult;
      await stopActive(true);
      publish({
        phase: 'failed',
        outcomes: {
          ...state.outcomes,
          [id]: { id, phase: 'failed', progress: 0, error: message(failure.reason) },
        },
        error: message(failure.reason),
      });
      return;
    }
    await refreshDownloads();
  };

  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    load,
    selectTier(tier) {
      // These tiers only preview download choices. They never change the live
      // model loading policy or the user's saved active model selections.
      if (state.phase === 'downloading') return;
      publish({
        phase: 'ready',
        selectedTier: tier,
        outcomes: {},
        error: null,
      });
    },
    toggleKind(kind) {
      if (state.phase === 'downloading') return;
      const plan = selectedPlan();
      const item = plan && [...plan.items, ...(plan.embedding ? [plan.embedding] : [])]
        .find(candidate => candidate.kind === kind);
      if (!item || !autoSetupItemNeedsAction(item, state.installedIds)) return;
      const selectedKinds = state.selectedKinds.includes(kind)
        ? state.selectedKinds.filter(selected => selected !== kind)
        : [...state.selectedKinds, kind];
      publish({ selectedKinds, outcomes: {}, error: null, phase: 'ready' });
    },
    start,
    async cancel() {
      if (state.phase !== 'downloading') return;
      operation += 1;
      await stopActive(true);
      publish({ phase: 'ready', error: null });
    },
    complete() {
      const plan = selectedPlan();
      if (plan && state.phase === 'completed') {
        const app = useAppStore.getState();
        if (state.selectedKinds.includes('text') && app.activeModelId === null) {
          activeModelService.selectTextModel(plan.items[0].id);
        }
        if (state.selectedKinds.includes('image') && app.activeImageModelId === null) {
          app.setActiveImageModelId(plan.items[1].id);
        }
        if (state.selectedKinds.includes('video') && app.activeVideoModelId === null && plan.items[3]) {
          app.setActiveVideoModelId(plan.items[3].id);
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      operation += 1;
      unsubscribeDownloads();
      // Leaving Auto Setup must not cancel model downloads. Their lifecycle belongs
      // to modelDownloadService, so Download Manager can keep showing and controlling
      // the same work after this screen is gone.
      activeIds.clear();
      listeners.clear();
    },
  };
}
