// Composition root: the shared selected-model resolver over Mobile's app store and route reads.
import { createSelectedModelResolver } from '@offgrid/models';
import type { DownloadedModel } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { activeLocalModelId } from '../modelServices/activeRoute';
import logger from '../../utils/logger';
import { once } from '@offgrid/models';

export const selectedTextModel = once(() =>
  createSelectedModelResolver<DownloadedModel>({
    read: () => {
      const state = useAppStore.getState();
      return { models: state.downloadedModels, selectedId: activeLocalModelId('text') };
    },
    warn: message => logger.warn(message),
  }),
);
