import { Dispatch, SetStateAction, useEffect } from 'react';
import type { ModelSettingsRecord } from '@offgrid/application';
import { AlertState, showAlert } from '../../components';
import { modelLibrary } from '../../services';
import {
  selectModelRoute,
  unloadAndClearModel,
} from '../../services/modelServices/modelFacadeCommands';
import { mobileTextEngineControl } from '../../services/modelServices/textEngineControl';
import { useAppStore } from '../../stores';
import { activeLocalModelId } from '../../services/modelServices/activeRoute';
import {
  Conversation,
  DownloadedModel,
  RemoteModel,
  ONNXImageModel,
} from '../../types';
import { ModelReadyOutcome } from './modelReadiness';
import { mobileChatModelReadiness } from '../../services/modelServices/chatModelReadinessPort';
import { activeMobileRoute } from '../../services/modelServices/mobileLLMService';
import { mobileChatSession } from './mobileChatSession';
import { appendWorkspaceAssistantMessage } from './useChatGenerationActions';
import logger from '../../utils/logger';

type SetState<T> = Dispatch<SetStateAction<T>>;

type ActiveModelInfo = {
  isRemote: boolean;
  model: DownloadedModel | RemoteModel | null;
  modelId: string | null;
  modelName: string;
};

type ModelActionDeps = {
  activeModel: DownloadedModel | null | undefined;
  activeModelId: string | null;
  activeModelInfo?: ActiveModelInfo;
  hasActiveModel?: boolean;
  activeConversationId: string | null | undefined;
  /** Canonical Workspace Content projection - the only source for the fallback-notice dedupe check. */
  activeConversation?: Conversation;
  isStreaming: boolean;
  settings: ModelSettingsRecord;
  clearStreamingMessage: () => void;
  setIsModelLoading: (loading: boolean) => void;
  setLoadingModel: (model: DownloadedModel | null) => void;
  setShowModelSelector: SetState<boolean>;
  setAlertState: SetState<AlertState>;
  modelLoadStartTimeRef: React.MutableRefObject<number | null>;
};

import { InteractionManager } from 'react-native';

/** Wait for loading UI to render before blocking the JS bridge with native calls. */
function waitForRenderFrame(): Promise<void> {
  return new Promise<void>(resolve => {
    InteractionManager.runAfterInteractions(() => setTimeout(resolve, 350));
  });
}

function addSystemMsg(
  deps: Pick<ModelActionDeps, 'activeConversationId' | 'settings'>,
  content: string,
) {
  if (
    !deps.activeConversationId ||
    deps.settings.showGenerationDetails !== true
  )
    return;
  appendWorkspaceAssistantMessage(deps.activeConversationId, `_${content}_`, {
    notice: true,
  }).catch(() => undefined);
}

/**
 * Surface a silent backend downgrade after a successful load — NOT gated on showGenerationDetails:
 * a user who explicitly selected GPU and got CPU must see it without any debug setting (the
 * device-reported "Backend=GPU but the turn ran on CPU" class). The verdict is owned by the
 * Shared control plane through the native runtime port; this only renders it.
 */
function addBackendFallbackMsg(
  deps: Pick<
    ModelActionDeps,
    'activeModel' | 'activeConversationId' | 'activeConversation'
  >,
) {
  const notice = mobileTextEngineControl.backendFallbackNotice(
    deps.activeModel?.id,
  );
  if (!notice || !deps.activeConversationId) return;
  logger.warn('[TextEngine] GPU fallback:', notice);
  // Read from the canonical Workspace Content projection - the legacy Zustand mirror never sees a
  // message written through Workspace Content, so a dedupe check against it would always miss and
  // this notice would be appended again on every reload.
  const alreadyVisible = (deps.activeConversation?.messages ?? []).some(
    message => message.isSystemInfo && message.content.includes(notice),
  );
  if (alreadyVisible) return;
  appendWorkspaceAssistantMessage(deps.activeConversationId, `_${notice}_`, {
    notice: true,
  }).catch(() => undefined);
}

export async function initiateModelLoad(
  deps: ModelActionDeps,
  alreadyLoading: boolean,
  options?: { force?: boolean },
): Promise<ModelReadyOutcome> {
  const force = typeof options === 'object' && !!options.force;
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId)
    return { ok: false, reason: 'no-model-selected', forceLoadAllowed: false };
  let started = false;

  try {
    const service = mobileChatModelReadiness({
      activeModel,
      activeModelId,
      remote: !!deps.activeModelInfo?.isRemote,
      beforeLoad: alreadyLoading
        ? undefined
        : async () => {
            started = true;
            deps.setIsModelLoading(true);
            deps.setLoadingModel(activeModel);
            deps.modelLoadStartTimeRef.current = Date.now();
            await waitForRenderFrame();
          },
    });
    const outcome = force
      ? await service.forceLoad()
      : await service.ensureReady();
    if (!outcome.ok) return outcome;
    if (
      started &&
      deps.modelLoadStartTimeRef.current &&
      deps.settings.showGenerationDetails === true
    ) {
      const loadTime = (
        (Date.now() - deps.modelLoadStartTimeRef.current) /
        1000
      ).toFixed(1);
      addSystemMsg(deps, `Model loaded: ${activeModel.name} (${loadTime}s)`);
    }
    addBackendFallbackMsg(deps);
    return outcome;
  } finally {
    if (started) {
      deps.setIsModelLoading(false);
      deps.setLoadingModel(null);
      deps.modelLoadStartTimeRef.current = null;
    }
  }
}

/**
 * For a chat request with no text model loaded: load the last-selected text
 * model (residency manager fits it into memory), or open the model selector
 * if the user never chose one. Returns true when a model is loading/loaded.
 */
export async function ensureTextModelForChatFn(deps: {
  setShowModelSelector: (v: boolean) => void;
  setLoadingModel: (m: DownloadedModel | null) => void;
  setIsModelLoading: (v: boolean) => void;
}): Promise<boolean> {
  // The shared selection is the one owner of the text route. A remote route needs no local
  // load; a local one is loaded by id. The old local-only id lagged behind a remote switch and
  // loaded a stale small model beside the remote one.
  const active = activeMobileRoute('text').model;
  const remote = active?.source === 'remote';
  const modelId = active?.source === 'local' ? active.id : null;
  const model =
    useAppStore.getState().downloadedModels.find(m => m.id === modelId) ?? null;
  let started = false;
  const service = mobileChatModelReadiness({
    activeModel: model,
    activeModelId: modelId,
    remote,
    beforeLoad: () => {
      started = true;
      deps.setLoadingModel(model);
      deps.setIsModelLoading(true);
    },
  });
  try {
    const outcome = await service.ensureReady();
    if (!outcome.ok && outcome.reason === 'no-model-selected') {
      deps.setShowModelSelector(true);
    }
    return outcome.ok;
  } finally {
    if (started) {
      deps.setIsModelLoading(false);
      deps.setLoadingModel(null);
    }
  }
}

export async function ensureModelLoadedFn(
  deps: ModelActionDeps,
): Promise<ModelReadyOutcome> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId)
    return { ok: false, reason: 'no-model-selected', forceLoadAllowed: false };
  return initiateModelLoad(deps, false);
}

export async function forceLoadModelFn(
  deps: ModelActionDeps,
): Promise<ModelReadyOutcome> {
  return initiateModelLoad(deps, false, { force: true });
}

/**
 * A picker tap changes the canonical route only. The first local generation owns
 * residency acquisition through ChatModelReadinessService. This keeps navigation
 * and selection free of native model I/O.
 */
export async function handleModelSelectFn(
  deps: ModelActionDeps,
  model: DownloadedModel,
): Promise<void> {
  await selectModelRoute({
    source: 'local',
    hostId: model.engine,
    modality: 'text',
    modelId: model.id,
  });
  deps.setShowModelSelector(false);
}

export async function handleUnloadModelFn(
  deps: ModelActionDeps,
): Promise<void> {
  const { activeModel, isStreaming, clearStreamingMessage } = deps;
  if (isStreaming) {
    if (deps.activeConversationId)
      mobileChatSession.stopConversation(deps.activeConversationId);
    else mobileChatSession.stop();
    clearStreamingMessage();
  }
  const modelName = activeModel?.name;
  deps.setIsModelLoading(true);
  deps.setLoadingModel(activeModel ?? null);
  try {
    await unloadAndClearModel('text');
    if (deps.settings.showGenerationDetails === true && modelName) {
      addSystemMsg(deps, `Model unloaded: ${modelName}`);
    }
  } catch (error) {
    deps.setAlertState(
      showAlert('Error', `Failed to unload model: ${(error as Error).message}`),
    );
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
    deps.setShowModelSelector(false);
  }
}

type ImageModelEffectsDeps = {
  setDownloadedImageModels: (models: ONNXImageModel[]) => void;
};
export function useChatImageModelEffects(deps: ImageModelEffectsDeps): void {
  const { setDownloadedImageModels } = deps;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!cancelled) {
        const models = await modelLibrary.getDownloadedImageModels();
        if (cancelled) return;
        // Never orphan the currently-active image model: activeImageModelId is persisted
        // but downloadedImageModels is not, so on a cold mount the disk scan is the sole
        // hydrator. If it hasn't surfaced the active model yet (slow FS, or one already
        // placed in the store), keep that entry rather than blanking the selection —
        // otherwise activeImageModel resolves to undefined and image routing dies.
        const { downloadedImageModels: current } = useAppStore.getState();
        const activeId = activeLocalModelId('image');
        const merged =
          activeId && !models.some(m => m.id === activeId)
            ? [...models, ...current.filter(m => m.id === activeId)]
            : models;
        setDownloadedImageModels(merged);
      }
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [setDownloadedImageModels]);
}
