import { useEffect } from 'react';
import { modelManager } from '../../services';
import { activeTextCapabilities } from '../../services/engines';
import { useAppStore } from '../../stores';
import type { DownloadedModel, ONNXImageModel } from '../../types';

type ImageModelEffectsDeps = {
  setDownloadedImageModels: (models: ONNXImageModel[]) => void;
};

export function useChatImageModelEffects(deps: ImageModelEffectsDeps): void {
  const { setDownloadedImageModels } = deps;
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      const models = await modelManager.getDownloadedImageModels();
      if (cancelled) return;
      // Never orphan the persisted active image model while the disk scan hydrates.
      const { downloadedImageModels: current, activeImageModelId: activeId } =
        useAppStore.getState();
      const merged =
        activeId && !models.some(model => model.id === activeId)
          ? [...models, ...current.filter(model => model.id === activeId)]
          : models;
      setDownloadedImageModels(merged);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [setDownloadedImageModels]);
  // Do not preload the private classifier: it must never become the selected chat model.
}

type ModelStateSyncDeps = {
  activeModelInfo: { isRemote: boolean };
  activeModelId: string | null;
  activeModel: DownloadedModel | undefined;
  modelDeps: unknown;
  activeRemoteModel: {
    capabilities?: {
      supportsVision?: boolean;
      supportsToolCalling?: boolean;
      supportsThinking?: boolean;
    };
  } | null;
  activeRemoteTextModelId: string | null;
  isModelLoading: boolean;
  setSupportsVision: (value: boolean) => void;
  setSupportsToolCalling: (value: boolean) => void;
  setSupportsThinking: (value: boolean) => void;
};

export function useChatModelStateSync(deps: ModelStateSyncDeps): void {
  const {
    activeModelInfo,
    activeModelId,
    activeModel,
    activeRemoteModel,
    activeRemoteTextModelId,
    isModelLoading,
    setSupportsVision,
    setSupportsToolCalling,
    setSupportsThinking,
  } = deps;
  const remoteCapabilities = activeRemoteModel?.capabilities;
  const activeModelMmProjPath =
    activeModel?.engine === 'llama' ? activeModel.mmProjPath : undefined;

  // Model loading stays lazy; these effects only project current capabilities into UI state.
  useEffect(() => {
    setSupportsVision(
      activeTextCapabilities({
        isRemote: activeModelInfo.isRemote,
        remoteCaps: remoteCapabilities,
        model: activeModel,
      }).vision,
    );
  }, [
    activeModel,
    activeModelInfo.isRemote,
    activeModelMmProjPath,
    isModelLoading,
    remoteCapabilities,
    setSupportsVision,
  ]);

  useEffect(() => {
    const capabilities = activeTextCapabilities({
      isRemote: !!activeRemoteTextModelId,
      remoteCaps: remoteCapabilities,
      model: activeModel,
    });
    setSupportsToolCalling(capabilities.tools);
    setSupportsThinking(capabilities.thinking);
  }, [
    activeModel,
    activeModelId,
    activeRemoteTextModelId,
    isModelLoading,
    remoteCapabilities,
    setSupportsThinking,
    setSupportsToolCalling,
  ]);
}
