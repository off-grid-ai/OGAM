import { Dispatch, SetStateAction, useEffect } from 'react';
import {
  AlertState,
  showAlert,
  hideAlert,
} from '../../components';
import { llmService, activeModelService, modelManager, generationService } from '../../services';
import { isModelReady, activeLocalTextCapabilities, activeTextCapabilities, backendFallbackNotice } from '../../services/engines';
import { useAppStore } from '../../stores';
import { DownloadedModel, RemoteModel, ONNXImageModel, isLiteRTModel } from '../../types';
import logger from '../../utils/logger';
import { ModelReadyOutcome, reasonFromLoadError } from './modelReadiness';
import { isOverridableMemoryError } from '../../services/modelLoadErrors';
import { loadModelWithOverride, memoryRefusalAlert } from '../../services/loadModelWithOverride';

type SetState<T> = Dispatch<SetStateAction<T>>;

/** Vision support for a just-loaded local model, via the single engine-registry reader
 *  (engines.activeLocalTextCapabilities) — so these post-load sites don't branch on the engine. */
function loadedModelVision(model: DownloadedModel): boolean {
  return activeLocalTextCapabilities(model).vision;
}

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
  isStreaming: boolean;
  settings: { showGenerationDetails: boolean };
  clearStreamingMessage: () => void;
  createConversation: (modelId: string, title?: string, projectId?: string) => string;
  addMessage: (convId: string, msg: any) => void;
  setIsModelLoading: (loading: boolean) => void;
  setLoadingModel: (model: DownloadedModel | null) => void;
  setSupportsVision: SetState<boolean>;
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
  deps: Pick<ModelActionDeps, 'activeConversationId' | 'settings' | 'addMessage'>,
  content: string,
) {
  if (!deps.activeConversationId || !deps.settings.showGenerationDetails) return;
  deps.addMessage(deps.activeConversationId, {
    role: 'assistant',
    content: `_${content}_`,
    isSystemInfo: true,
  });
}

/**
 * Surface a silent backend downgrade after a successful load — NOT gated on showGenerationDetails:
 * a user who explicitly selected GPU and got CPU must see it without any debug setting (the
 * device-reported "Backend=GPU but the turn ran on CPU" class). The verdict is owned by the
 * engine layer (engines.backendFallbackNotice); this only renders it.
 */
function addBackendFallbackMsg(deps: Pick<ModelActionDeps, 'activeModel' | 'activeConversationId' | 'addMessage'>) {
  const notice = backendFallbackNotice(deps.activeModel);
  if (!notice || !deps.activeConversationId) return;
  deps.addMessage(deps.activeConversationId, {
    role: 'assistant',
    content: `_${notice}_`,
    isSystemInfo: true,
  });
}

async function doLoadTextModel(deps: ModelActionDeps, opts?: { override?: boolean }): Promise<boolean> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return false;
  try {
    await activeModelService.loadTextModel(activeModelId, undefined, opts);
    deps.setSupportsVision(loadedModelVision(activeModel));
    if (deps.modelLoadStartTimeRef.current && deps.settings.showGenerationDetails) {
      const loadTime = ((Date.now() - deps.modelLoadStartTimeRef.current) / 1000).toFixed(1);
      addSystemMsg(deps, `Model loaded: ${activeModel.name} (${loadTime}s)`);
    }
    addBackendFallbackMsg(deps);
    return true;
  } catch (error: any) {
    deps.setAlertState(showAlert('Error', `Failed to load model: ${error?.message || 'Unknown error'}`));
    return false;
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
    deps.modelLoadStartTimeRef.current = null;
  }
}

export async function initiateModelLoad(
  deps: ModelActionDeps,
  alreadyLoading: boolean,
  /** When the load was requested to satisfy a chat turn, resume that turn after a
   *  successful "Load Anyway". Non-generation callers (model select / reload) omit it,
   *  so nothing is auto-resumed for them. */
  onLoadedResume?: () => void,
): Promise<ModelReadyOutcome> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return { ok: false, reason: 'no-model-selected' };

  if (!alreadyLoading) {
    // No predictive pre-check gate here: the MEASURED residency loader below
    // (loadTextModel → makeRoomFor) is the single authoritative gate, and its
    // OverridableMemoryError drives the identical "Load Anyway" affordance in the
    // catch block. The old fileSize×1.5 pre-check blocked models the measured
    // loader accepts, diverging from Home (bug OD3) — removed.
    deps.setIsModelLoading(true);
    deps.setLoadingModel(activeModel);
    deps.modelLoadStartTimeRef.current = Date.now();
    await waitForRenderFrame();
  }

  try {
    await activeModelService.loadTextModel(activeModelId);
    deps.setSupportsVision(loadedModelVision(activeModel));
    if (!alreadyLoading && deps.modelLoadStartTimeRef.current && deps.settings.showGenerationDetails) {
      const loadTime = ((Date.now() - deps.modelLoadStartTimeRef.current) / 1000).toFixed(1);
      addSystemMsg(deps, `Model loaded: ${activeModel.name} (${loadTime}s)`);
    }
    if (!alreadyLoading) addBackendFallbackMsg(deps);
    return { ok: true };
  } catch (error: any) {
    const detail = error?.message || 'Unknown error';
    // Previously this returned void and swallowed the error silently whenever
    // alreadyLoading was true — the exact bug that produced a generic "Failed to
    // load model" with no trace and no way to tell which branch failed. Always
    // return the typed reason now; only the !alreadyLoading path shows the alert
    // here (behavior-neutral), and the caller decides what to render otherwise.
    if (!alreadyLoading) {
      // The residency gate can block a load the conservative pre-check let through.
      // That is overridable — offer "Load Anyway" (force the load) rather than a
      // dead-end "Failed to load model" the user can only dismiss.
      if (isOverridableMemoryError(error)) {
        deps.setAlertState(memoryRefusalAlert(detail, {
          onCancel: () => {
            deps.setAlertState(hideAlert());
            activeModelService.keepLoadedTextModelSelected();
          },
          onChooseModel: () => {
            deps.setAlertState(hideAlert());
            activeModelService.keepLoadedTextModelSelected();
            deps.setShowModelSelector(true);
          },
          onTryAnyway: () => {
            deps.setAlertState(hideAlert());
            deps.setIsModelLoading(true);
            deps.setLoadingModel(activeModel);
            deps.modelLoadStartTimeRef.current = Date.now();
            waitForRenderFrame()
              .then(() => doLoadTextModel(deps, { override: true }))
              // Resume once the load resolves — don't gate on isModelLoaded() (races
              // false after a multimodal load, dropping the resume). See the sibling path.
              .then(loaded => { if (loaded) onLoadedResume?.(); })
              .catch((e) => logger.error('[ModelLoad] Load Anyway resume failed:', e));
          },
        }));
        return { ok: false, reason: 'insufficient-memory', detail, alerted: true };
      }
      deps.setAlertState(showAlert('Error', `Failed to load model: ${detail}`));
    }
    return { ok: false, reason: reasonFromLoadError(error), detail, alerted: !alreadyLoading };
  } finally {
    if (!alreadyLoading) {
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
  setAlertState: (a: AlertState) => void;
  /** Sends the stashed turn once a "Load Anyway" retry has loaded the model. */
  resumePendingMessage: () => void;
}): Promise<boolean> {
  // The SELECTION first, remembered choice second - from the service, which owns that order. Reading
  // lastTextModelId alone loaded the previously-picked model and left the selected one on screen.
  const modelId = activeModelService.selectedTextModelId();
  if (!modelId) {
    deps.setShowModelSelector(true);
    return false;
  }
  const model = useAppStore.getState().downloadedModels.find(m => m.id === modelId) ?? null;
  // A refused or failed load is shown (with "Load Anyway" when the memory gate refused it). This
  // path used to swallow the error: the turn waited with no reply and nothing on screen.
  let loadedNow = false;
  let retrying = false;
  await loadModelWithOverride(
    opts => activeModelService.loadTextModel(modelId, undefined, opts),
    {
      setAlertState: deps.setAlertState,
      onAttemptStart: () => {
        deps.setLoadingModel(model);
        deps.setIsModelLoading(true);
      },
      onAttemptEnd: () => {
        deps.setIsModelLoading(false);
        deps.setLoadingModel(null);
      },
      onSuccess: () => {
        if (retrying) deps.resumePendingMessage();
        else loadedNow = true;
      },
      // The way forward from a refusal: pick a model that fits. The waiting turn goes out after the pick.
      onChooseModel: () => {
        deps.setAlertState(hideAlert());
        activeModelService.keepLoadedTextModelSelected();
        deps.setShowModelSelector(true);
      },
    },
  );
  retrying = true;
  return loadedNow;
}

export async function ensureModelLoadedFn(
  deps: ModelActionDeps,
  onLoadedResume?: () => void,
): Promise<ModelReadyOutcome> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return { ok: false, reason: 'no-model-selected' };
  // Vision-repair (llama only): a vision model whose mmproj didn't load reports no vision — force a
  // reload so it comes back with vision. LiteRT has no separate mmproj, so this never applies.
  const needsVisionRepair = !isLiteRTModel(activeModel)
    && !!activeModel.mmProjPath
    && !(llmService.getMultimodalSupport()?.vision);
  // ONE readiness predicate for both engines (engines.isModelReady); vision from the single rule.
  if (isModelReady(activeModel) && !needsVisionRepair) {
    deps.setSupportsVision(loadedModelVision(activeModel));
    return { ok: true };
  }
  deps.setSupportsVision(loadedModelVision(activeModel)); // LiteRT: known from the flag pre-load
  // The model is resident without its projector: a plain load returns at once ("already loaded"), so free
  // it first (keeping the selection) and the load below starts it again with the projector.
  if (needsVisionRepair && isModelReady(activeModel)) await activeModelService.unloadTextModel(true);
  const outcome = await initiateModelLoad(deps, activeModelService.getActiveModels().text.isLoading, onLoadedResume);
  if (!outcome.ok) return outcome;
  // Post-verify against native truth — catches a load that reported ok but left no resident model.
  return isModelReady(activeModel)
    ? { ok: true }
    : { ok: false, reason: 'load-threw', detail: 'the model is not resident after load' };
}

export async function handleModelSelectFn(
  deps: ModelActionDeps,
  model: DownloadedModel,
): Promise<void> {
  activeModelService.selectTextModel(model.id);
  deps.setShowModelSelector(false);
}

export async function handleUnloadModelFn(deps: ModelActionDeps): Promise<void> {
  const { activeModel, isStreaming, clearStreamingMessage } = deps;
  if (isStreaming) {
    // Through the OWNER, not the llama engine. llmService is llama.cpp only, so unloading while a LiteRT or
    // remote reply was streaming used to stop nothing while clearStreamingMessage wiped the screen — tokens
    // kept arriving for a reply the user could no longer see. generationService stops every engine, aborts a
    // remote request, and keeps whatever had already streamed (the same thing STOP does).
    await generationService.stopGeneration();
    clearStreamingMessage();
  }
  const modelName = activeModel?.name;
  deps.setIsModelLoading(true);
  deps.setLoadingModel(activeModel ?? null);
  try {
    await activeModelService.unloadTextModel();
    deps.setSupportsVision(false);
    if (deps.settings.showGenerationDetails && modelName) {
      addSystemMsg(deps, `Model unloaded: ${modelName}`);
    }
  } catch (error) {
    deps.setAlertState(showAlert('Error', `Failed to unload model: ${(error as Error).message}`));
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
        const models = await modelManager.getDownloadedImageModels();
        if (cancelled) return;
        // Never orphan the currently-active image model: activeImageModelId is persisted
        // but downloadedImageModels is not, so on a cold mount the disk scan is the sole
        // hydrator. If it hasn't surfaced the active model yet (slow FS, or one already
        // placed in the store), keep that entry rather than blanking the selection —
        // otherwise activeImageModel resolves to undefined and image routing dies.
        const { downloadedImageModels: current, activeImageModelId: activeId } = useAppStore.getState();
        const merged = activeId && !models.some(m => m.id === activeId)
          ? [...models, ...current.filter(m => m.id === activeId)]
          : models;
        setDownloadedImageModels(merged);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };

  }, [setDownloadedImageModels]);
}

type ModelStateSyncDeps = {
  activeModelInfo: { isRemote: boolean };
  activeModelId: string | null;
  activeModel: DownloadedModel | undefined;
  activeRemoteModel: { capabilities?: { supportsVision?: boolean; supportsToolCalling?: boolean; supportsThinking?: boolean; thinkingLevelsOnly?: boolean } } | null;
  activeRemoteTextModelId: string | null;
  isModelLoading: boolean;
  setSupportsVision: (v: boolean) => void;
  setSupportsToolCalling: (v: boolean) => void;
  setSupportsThinking: (v: boolean) => void;
};
export function useChatModelStateSync(deps: ModelStateSyncDeps): void {
  const { activeModelInfo, activeModelId, activeModel, activeRemoteModel, activeRemoteTextModelId, isModelLoading, setSupportsVision, setSupportsToolCalling, setSupportsThinking } = deps;
  const activeModelMmProjPath = activeModel?.engine === 'llama' ? activeModel.mmProjPath : undefined;
  useEffect(() => {
    // Single capability rule (engines.activeTextCapabilities); vision keys on activeModelInfo.isRemote.
    setSupportsVision(activeTextCapabilities({
      isRemote: activeModelInfo.isRemote,
      remoteCaps: activeRemoteModel?.capabilities,
      model: activeModel,
    }).vision);
  }, [activeModelInfo.isRemote, activeRemoteModel?.capabilities?.supportsVision, activeModelMmProjPath, isModelLoading]);
  useEffect(() => {
    // Same rule; tools/thinking key on activeRemoteTextModelId (preserved from the prior branch).
    const caps = activeTextCapabilities({
      isRemote: !!activeRemoteTextModelId,
      remoteCaps: activeRemoteModel?.capabilities,
      model: activeModel,
    });
    setSupportsToolCalling(caps.tools);
    setSupportsThinking(caps.thinking);
  }, [activeModelId, activeModel?.engine, isModelLoading, activeRemoteTextModelId, activeRemoteModel?.capabilities?.supportsToolCalling, activeRemoteModel?.capabilities?.supportsThinking, activeRemoteModel?.capabilities?.thinkingLevelsOnly]);
}
