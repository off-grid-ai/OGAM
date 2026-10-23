import { modelDownloadService } from './modelDownloadService';
import type { ModelDownload, ModelDownloadStartRequest } from './modelDownloadService/types';
import { useAppStore } from '../stores';
import { activeModelService } from './activeModelService';
import { flowFinished, flowStep } from './analytics/analytics';
import { uniformDownloadId } from './modelDownloadService/uniformId';
import {
  loadAutoSetupCompatibleCatalog,
  type AutoSetupCatalogBoundaries,
} from './autoSetupCatalog';
import {
  selectAutoSetupPlans,
  type AutoSetupPlan,
  type AutoSetupTier,
} from './autoSetupPlan';

export interface AutoSetupDownloadBoundaries {
  start: (request: ModelDownloadStartRequest) => Promise<void>;
  list: () => Promise<ModelDownload[]>;
  cancel: (id: string) => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

const productionDownloadBoundaries: AutoSetupDownloadBoundaries = {
  start: request => modelDownloadService.start(request),
  list: () => modelDownloadService.list(),
  cancel: id => modelDownloadService.cancel(id),
  subscribe: listener => modelDownloadService.subscribe(listener),
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
  outcomes: Record<string, AutoSetupItemOutcome>;
  error: string | null;
}

export interface AutoSetupSession {
  snapshot(): AutoSetupSnapshot;
  subscribe(listener: () => void): () => void;
  load(): Promise<void>;
  selectTier(tier: AutoSetupTier): void;
  start(): Promise<void>;
  complete(): void;
  dispose(): void;
}

export interface AutoSetupSessionBoundaries {
  catalog?: AutoSetupCatalogBoundaries;
  downloads?: AutoSetupDownloadBoundaries;
  catalogDeadlineMs?: number;
}

const DEFAULT_CATALOG_DEADLINE_MS = 15_000;
const TIER_POLICY = {
  lean: 'conservative',
  balanced: 'balanced',
  extreme: 'aggressive',
} as const;

function tierFromPersistedIntent(): AutoSetupTier {
  const mode = useAppStore.getState().settings.modelLoadingMode;
  if (mode === 'conservative') return 'lean';
  if (mode === 'aggressive') return 'extreme';
  return 'balanced';
}

function persistTierIntent(tier: AutoSetupTier): void {
  useAppStore
    .getState()
    .updateSettings({ modelLoadingMode: TIER_POLICY[tier] });
}

export function autoSetupDownloadId(
  item: AutoSetupPlan['items'][number],
): string {
  return uniformDownloadId(item.kind, item.id);
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
  plan: AutoSetupPlan,
): Record<string, AutoSetupItemOutcome> {
  return Object.fromEntries(
    plan.items.map(item => {
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
  const listeners = new Set<() => void>();
  const activeIds = new Set<string>();
  let disposed = false;
  let operation = 0;
  let refreshInFlight = false;
  let state: AutoSetupSnapshot = {
    phase: 'loading_catalog',
    plans: [],
    selectedTier: tierFromPersistedIntent(),
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

  const stopActive = async (cancelled: boolean): Promise<void> => {
    const ids = [...activeIds];
    activeIds.clear();
    await Promise.allSettled(ids.map(id => downloads.cancel(id)));
    if (cancelled && !disposed) {
      const outcomes = { ...state.outcomes };
      for (const id of ids) {
        const current = outcomes[id];
        if (current && current.phase !== 'completed') {
          outcomes[id] = { ...current, phase: 'cancelled' };
        }
      }
      publish({ outcomes });
    }
  };

  const refreshDownloads = async (): Promise<void> => {
    if (disposed || refreshInFlight || activeIds.size === 0) return;
    refreshInFlight = true;
    try {
      const listed = await downloads.list();
      if (disposed) return;
      const { outcomes, failure, allCompleted } = projectActiveDownloads(
        activeIds,
        listed,
        state.outcomes,
      );
      publish({ outcomes });
      if (failure) {
        operation += 1;
        await stopActive(false);
        publish({
          phase: 'failed',
          error: failure.error ?? 'A model download failed. Try again.',
        });
        flowFinished('onboarding', 'failed', failure.error);
      } else if (allCompleted) {
        activeIds.clear();
        publish({ phase: 'completed', error: null });
        flowStep('onboarding', 'download_done');
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
      publish({
        phase: 'ready',
        plans: selectAutoSetupPlans(catalog),
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

  const start = async (): Promise<void> => {
    const plan = selectedPlan();
    if (!plan || disposed) return;
    const token = ++operation;
    await stopActive(false);
    const existing = await downloads.list();
    if (disposed || token !== operation) return;
    const completedIds = new Set(
      existing
        .filter(download => download.status === 'completed')
        .map(download => download.id),
    );
    const outcomes = initialOutcomes(plan);
    for (const item of plan.items) {
      const id = autoSetupDownloadId(item);
      if (completedIds.has(id))
        outcomes[id] = { id, phase: 'completed', progress: 1 };
      else {
        outcomes[id] = { id, phase: 'starting', progress: 0 };
        activeIds.add(id);
      }
    }
    publish({
      phase: activeIds.size ? 'downloading' : 'completed',
      outcomes,
      error: null,
    });
    flowStep('onboarding', 'download_started');
    if (activeIds.size === 0) {
      flowStep('onboarding', 'download_done');
      return;
    }

    const [text, image, stt] = plan.items;
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
    ].filter(job => activeIds.has(job.id));
    const starts = await Promise.allSettled(jobs.map(job => job.run()));
    if (disposed || token !== operation) return;
    const failedIndex = starts.findIndex(
      result => result.status === 'rejected',
    );
    if (failedIndex >= 0) {
      const id = jobs[failedIndex].id;
      const failure = starts[failedIndex] as PromiseRejectedResult;
      const next = {
        ...state.outcomes,
        [id]: {
          id,
          phase: 'failed' as const,
          progress: 0,
          error: message(failure.reason),
        },
      };
      await stopActive(false);
      publish({
        phase: 'failed',
        outcomes: next,
        error: message(failure.reason),
      });
      flowFinished('onboarding', 'failed', failure.reason);
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
      // The selected plan is immutable once its download session starts. If a
      // completed or active session could switch tiers, its outcomes would
      // describe the old plan while complete() activated the new plan.
      if (state.phase === 'downloading' || state.phase === 'completed') return;
      persistTierIntent(tier);
      publish({
        phase: 'ready',
        selectedTier: tier,
        outcomes: {},
        error: null,
      });
    },
    start,
    complete() {
      const plan = selectedPlan();
      if (plan && state.phase === 'completed') {
        const app = useAppStore.getState();
        if (app.activeModelId === null) {
          activeModelService.selectTextModel(plan.items[0].id);
        }
        if (app.activeImageModelId === null) {
          app.setActiveImageModelId(plan.items[1].id);
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
