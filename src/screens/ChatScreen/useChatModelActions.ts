import { Dispatch, SetStateAction, useEffect } from 'react';
import {
  AlertState,
  showAlert,
  hideAlert,
} from '../../components';
import { llmService, activeModelService, modelManager } from '../../services';
import { liteRTService } from '../../services/litert';
import { useAppStore } from '../../stores';
import { DownloadedModel, RemoteModel, ONNXImageModel } from '../../types';
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
  isStreaming: boolean;
  settings: { showGenerationDetails: boolean };
  clearStreamingMessage: () => void;
  createConversation: (modelId: string, title?: string, projectId?: string) => string;
  addMessage: (convId: string, msg: any) => void;
  setIsModelLoading: SetState<boolean>;
  setLoadingModel: SetState<DownloadedModel | null>;
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

async function doLoadTextModel(deps: ModelActionDeps): Promise<void> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return;
  try {
    await activeModelService.loadTextModel(activeModelId);
    const multimodalSupport = llmService.getMultimodalSupport();
    deps.setSupportsVision(activeModel.engine === 'litert' ? !!activeModel.liteRTVision : (multimodalSupport?.vision || false));
    if (deps.modelLoadStartTimeRef.current && deps.settings.showGenerationDetails) {
      const loadTime = ((Date.now() - deps.modelLoadStartTimeRef.current) / 1000).toFixed(1);
      addSystemMsg(deps, `Model loaded: ${activeModel.name} (${loadTime}s)`);
    }
  } catch (error: any) {
    deps.setAlertState(showAlert('Error', `Failed to load model: ${error?.message || 'Unknown error'}`));
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
    deps.modelLoadStartTimeRef.current = null;
  }
}

export async function initiateModelLoad(
  deps: ModelActionDeps,
  alreadyLoading: boolean,
): Promise<void> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return;

  if (!alreadyLoading) {
    const memoryCheck = await activeModelService.checkMemoryForModel(activeModelId, 'text');
    if (!memoryCheck.canLoad) {
      const startLoad = () => {
        deps.setAlertState(hideAlert());
        deps.setIsModelLoading(true);
        deps.setLoadingModel(activeModel);
        deps.modelLoadStartTimeRef.current = Date.now();
        return waitForRenderFrame();
      };
      // When the block is caused by other loaded models, offer a one-tap
      // "unload others & load" recovery so the user is never left stuck.
      const buttons = memoryCheck.resolvableByUnload
        ? [
            { text: 'Cancel', style: 'cancel' as const },
            {
              text: 'Unload others & load', style: 'default' as const, onPress: () => {
                startLoad()
                  .then(() => activeModelService.unloadAllModels())
                  .catch(err => logger.error('Failed to unload models before load:', err))
                  .then(() => doLoadTextModel(deps));
              },
            },
          ]
        : [
            { text: 'Cancel', style: 'cancel' as const },
            {
              text: 'Load Anyway', style: 'destructive' as const, onPress: () => {
                startLoad().then(() => doLoadTextModel(deps));
              },
            },
          ];
      deps.setAlertState(showAlert(
        'Insufficient Memory',
        `Cannot load ${activeModel.name}. ${memoryCheck.message}`,
        buttons,
      ));
      return;
    }
    deps.setIsModelLoading(true);
    deps.setLoadingModel(activeModel);
    deps.modelLoadStartTimeRef.current = Date.now();
    await waitForRenderFrame();
  }

  try {
    await activeModelService.loadTextModel(activeModelId);
    const multimodalSupport = llmService.getMultimodalSupport();
    deps.setSupportsVision(activeModel.engine === 'litert' ? !!activeModel.liteRTVision : (multimodalSupport?.vision || false));
    if (!alreadyLoading && deps.modelLoadStartTimeRef.current && deps.settings.showGenerationDetails) {
      const loadTime = ((Date.now() - deps.modelLoadStartTimeRef.current) / 1000).toFixed(1);
      addSystemMsg(deps, `Model loaded: ${activeModel.name} (${loadTime}s)`);
    }
  } catch (error: any) {
    if (!alreadyLoading) {
      deps.setAlertState(showAlert('Error', `Failed to load model: ${error?.message || 'Unknown error'}`));
    }
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
}): Promise<boolean> {
  const { lastTextModelId, downloadedModels } = useAppStore.getState();
  if (!lastTextModelId) {
    deps.setShowModelSelector(true);
    return false;
  }
  deps.setLoadingModel(downloadedModels.find(m => m.id === lastTextModelId) ?? null);
  deps.setIsModelLoading(true);
  try {
    await activeModelService.loadTextModel(lastTextModelId);
    return true;
  } catch {
    return false;
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
  }
}

export async function ensureModelLoadedFn(
  deps: ModelActionDeps,
): Promise<void> {
  const { activeModel, activeModelId } = deps;
  if (!activeModel || !activeModelId) return;
  if (activeModel.engine === 'litert') {
    if (liteRTService.isModelLoaded()) {
      deps.setSupportsVision(!!activeModel.liteRTVision);
      return;
    }
    deps.setSupportsVision(!!activeModel.liteRTVision);
    if (deps.activeModelId) await initiateModelLoad(deps, activeModelService.getActiveModels().text.isLoading);
    return;
  }
  const loadedPath = llmService.getLoadedModelPath();
  const currentVisionSupport = llmService.getMultimodalSupport()?.vision || false;
  const needsReload = loadedPath !== activeModel.filePath ||
    (activeModel.mmProjPath && !currentVisionSupport);
  if (!needsReload && loadedPath === activeModel.filePath) {
    deps.setSupportsVision(currentVisionSupport);
    return;
  }
  const alreadyLoading = activeModelService.getActiveModels().text.isLoading;
  await initiateModelLoad(deps, alreadyLoading);
}

export async function proceedWithModelLoadFn(
  deps: ModelActionDeps,
  model: DownloadedModel,
): Promise<void> {
  deps.setIsModelLoading(true);
  deps.setLoadingModel(model);
  deps.modelLoadStartTimeRef.current = Date.now();
  await waitForRenderFrame();
  try {
    await activeModelService.loadTextModel(model.id);
    const multimodalSupport = llmService.getMultimodalSupport();
    deps.setSupportsVision(model.engine === 'litert' ? !!model.liteRTVision : (multimodalSupport?.vision || false));
    if (deps.modelLoadStartTimeRef.current && deps.settings.showGenerationDetails && deps.activeConversationId) {
      const loadTime = ((Date.now() - deps.modelLoadStartTimeRef.current) / 1000).toFixed(1);
      deps.addMessage(deps.activeConversationId, {
        role: 'assistant',
        content: `_Model loaded: ${model.name} (${loadTime}s)_`,
        isSystemInfo: true,
      });
    }
  } catch (error) {
    deps.setAlertState(showAlert('Error', `Failed to load model: ${(error as Error).message}`));
  } finally {
    deps.setIsModelLoading(false);
    deps.setLoadingModel(null);
    deps.setShowModelSelector(false);
    deps.modelLoadStartTimeRef.current = null;
  }
}

export async function handleModelSelectFn(
  deps: ModelActionDeps,
  model: DownloadedModel,
): Promise<void> {
  if (llmService.getLoadedModelPath() === model.filePath) {
    deps.setShowModelSelector(false);
    return;
  }
  const memoryCheck = await activeModelService.checkMemoryForModel(model.id, 'text');
  if (!memoryCheck.canLoad) {
    // When other loaded models are the cause, offer a one-tap "unload others &
    // load" recovery so the user is never left at a dead end. Otherwise the
    // model is too large on its own and only "Load Anyway" makes sense.
    const buttons = memoryCheck.resolvableByUnload
      ? [
          { text: 'Cancel', style: 'cancel' as const },
          {
            text: 'Unload others & load', style: 'default' as const, onPress: () => {
              deps.setAlertState(hideAlert());
              // Show the loading state before unloading — unloading can take a
              // few seconds and would otherwise leave the UI looking frozen.
              deps.setIsModelLoading(true);
              deps.setLoadingModel(model);
              deps.modelLoadStartTimeRef.current = Date.now();
              waitForRenderFrame()
                .then(() => activeModelService.unloadAllModels())
                .catch(err => logger.error('Failed to unload models before load:', err))
                .then(() => proceedWithModelLoadFn(deps, model));
            },
          },
        ]
      : [
          { text: 'Cancel', style: 'cancel' as const },
          {
            text: 'Load Anyway', style: 'destructive' as const, onPress: () => {
              deps.setAlertState(hideAlert());
              proceedWithModelLoadFn(deps, model);
            },
          },
        ];
    deps.setAlertState(showAlert('Insufficient Memory', memoryCheck.message, buttons));
    return;
  }
  if (memoryCheck.severity === 'warning') {
    deps.setAlertState(showAlert(
      'Low Memory Warning',
      memoryCheck.message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Load Anyway',
          style: 'default',
          onPress: () => {
            deps.setAlertState(hideAlert());
            proceedWithModelLoadFn(deps, model);
          },
        },
      ],
    ));
    return;
  }
  proceedWithModelLoadFn(deps, model);
}

export async function handleUnloadModelFn(deps: ModelActionDeps): Promise<void> {
  const { activeModel, isStreaming, clearStreamingMessage } = deps;
  if (isStreaming) {
    await llmService.stopGeneration();
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
  settings: { imageGenerationMode: string; autoDetectMethod: string; classifierModelId: string | null | undefined };
  activeImageModelId: string | null;
  downloadedModels: DownloadedModel[];
};
export function useChatImageModelEffects(deps: ImageModelEffectsDeps): void {
  const { setDownloadedImageModels, settings, activeImageModelId, downloadedModels } = deps;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!cancelled) {
        const models = await modelManager.getDownloadedImageModels();
        if (!cancelled) setDownloadedImageModels(models);
      }
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };

  }, []);
  useEffect(() => {
    let cancelled = false;
    const preload = async () => {
      if (
        settings.imageGenerationMode === 'auto' && settings.autoDetectMethod === 'llm' &&
        settings.classifierModelId && activeImageModelId
      ) {
        const classifierModel = downloadedModels.find(m => m.id === settings.classifierModelId);
        if (classifierModel?.filePath && !llmService.getLoadedModelPath()) {
          try {
            if (!cancelled) await activeModelService.loadTextModel(settings.classifierModelId);
          }
          catch (error) { if (!cancelled) logger.warn('[ChatScreen] Failed to preload classifier model:', error); }
        }
      }
    };
    preload();
    return () => { cancelled = true; };

  }, [settings.imageGenerationMode, settings.autoDetectMethod, settings.classifierModelId, activeImageModelId]);
}

type ModelStateSyncDeps = {
  activeModelInfo: { isRemote: boolean };
  activeModelId: string | null;
  activeModel: DownloadedModel | undefined;
  modelDeps: any;
  activeRemoteModel: { capabilities?: { supportsVision?: boolean; supportsToolCalling?: boolean; supportsThinking?: boolean } } | null;
  activeRemoteTextModelId: string | null;
  isModelLoading: boolean;
  setSupportsVision: (v: boolean) => void;
  setSupportsToolCalling: (v: boolean) => void;
  setSupportsThinking: (v: boolean) => void;
};
export function useChatModelStateSync(deps: ModelStateSyncDeps): void {
  const { activeModelInfo, activeModelId, activeModel, activeRemoteModel, activeRemoteTextModelId, isModelLoading, setSupportsVision, setSupportsToolCalling, setSupportsThinking } = deps;
  const activeModelMmProjPath = activeModel?.engine === 'llama' ? activeModel.mmProjPath : undefined;
  // The active text model is NOT loaded here (on chat mount / model select). It loads
  // lazily on send, when the generation path recognizes a local text model is needed
  // (ensureModelReady → ensureModelLoaded). Loading eagerly here is what made opening a
  // chat — and switching models — spin up the model before the user sent anything.
  useEffect(() => {
    if (activeModelInfo.isRemote) {
      setSupportsVision(activeRemoteModel?.capabilities?.supportsVision ?? false);
    } else if (activeModel?.engine === 'litert') {
      setSupportsVision(!!activeModel.liteRTVision);
    } else if (activeModelMmProjPath && llmService.isModelLoaded()) {
      setSupportsVision(llmService.getMultimodalSupport()?.vision ?? false);
    } else {
      setSupportsVision(false);
    }

  }, [activeModelInfo.isRemote, activeRemoteModel?.capabilities?.supportsVision, activeModelMmProjPath, isModelLoading]);
  useEffect(() => {
    if (activeRemoteTextModelId) {
      setSupportsToolCalling(activeRemoteModel?.capabilities?.supportsToolCalling ?? false);
      setSupportsThinking(activeRemoteModel?.capabilities?.supportsThinking ?? false);
    } else if (activeModel?.engine === 'litert' && liteRTService.isModelLoaded()) {
      setSupportsToolCalling(true);
      setSupportsThinking(true);
    } else if (llmService.isModelLoaded()) {
      setSupportsToolCalling(llmService.supportsToolCalling());
      setSupportsThinking(llmService.supportsThinking());
    } else {
      setSupportsToolCalling(false);
      setSupportsThinking(false);
    }

  }, [activeModelId, activeModel?.engine, isModelLoading, activeRemoteTextModelId, activeRemoteModel?.capabilities?.supportsToolCalling, activeRemoteModel?.capabilities?.supportsThinking]);
}
