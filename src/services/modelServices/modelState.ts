import { selectedModelId } from '@offgrid/models';
import type { DownloadedModel } from '../../types';
import { selectedTextModel } from '../composition/selected-text-model';
import { useAppStore } from '../../stores/appStore';
import { nativeModelLifecycle } from '../adapters/native/modelLifecycle';
import { activeModelSnapshot } from './modelStateSnapshot';
import type {
  ActiveModelInfo,
  ResourceUsage,
} from './modelStateTypes';
import { activeLocalModelId } from './activeRoute';
import { rememberedLocalTextModelId } from './modelSelectionProjection';
import { getResourceUsage as readResourceUsage } from './modelStateNativeProjection';

export function resolveSelectedTextModel(): DownloadedModel | null {
  return selectedTextModel()();
}

export function selectedTextModelId(): string | null {
  return selectedModelId({
    activeModelId: activeLocalModelId('text'),
    lastModelId: rememberedLocalTextModelId(),
  });
}

export function getActiveModels(): ActiveModelInfo {
  const store = useAppStore.getState();
  const native = nativeModelLifecycle.getState();
  return activeModelSnapshot({
    textModel: resolveSelectedTextModel(),
    imageModel: store.downloadedImageModels.find(
      model => model.id === activeLocalModelId('image'),
    ) ?? null,
    textIsLoaded: native.textIsLoaded,
    imageIsLoaded: native.imageIsLoaded,
    loading: native.loading,
  });
}

export function supportsAudioInput(): boolean {
  return nativeModelLifecycle.supportsAudioInput();
}

export async function getResourceUsage(): Promise<ResourceUsage> {
  return readResourceUsage();
}

export function syncWithNativeState(): Promise<void> {
  return nativeModelLifecycle.syncWithNativeState();
}

export function subscribeToModelState(listener: (state: ActiveModelInfo) => void): () => void {
  return nativeModelLifecycle.subscribe(() => listener(getActiveModels()));
}

export type { ActiveModelInfo, ResourceUsage } from './modelStateTypes';
