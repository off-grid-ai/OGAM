/** Mobile platform ports for the shared generation-intent classifier. Port-only. */
import type { GenerationIntent, GenerationIntentService } from '@offgrid/models';
import type { DownloadedModel } from '../types';
import { useAppStore } from '../stores';
import logger from '../utils/logger';
import { executeMobileClassification } from './mobileSidecarGeneration';
import { mobileRouteId } from './modelServices/mobileRoute';
import { explicitLocalModelId } from './modelServices/modelSelectionProjection';

export interface ClassifyOptions {
  useLLM: boolean;
  classifierModel?: DownloadedModel | null;
  onStatusChange?: (status: string) => void;
}

/** The dedicated classifier the user configured, when it is actually downloaded. */
export function configuredClassifierModel(): DownloadedModel | null {
  const modelId = explicitLocalModelId('classifier');
  if (!modelId) return null;
  return useAppStore.getState().downloadedModels.find(model => model.id === modelId) ?? null;
}

/**
 * Run one classification through the composed service. Mobile supplies classifier I/O and the
 * route it runs on; Shared owns the patterns, the fallback, and the cache.
 */
export async function classifyMobileIntent(
  service: GenerationIntentService,
  message: string,
  options: ClassifyOptions,
): Promise<GenerationIntent> {
  const intent = await service.classify(message, {
    useModel: options.useLLM,
    classifyWithModel: async query => {
      options.onStatusChange?.('Analyzing request...');
      const classifierModel = options.classifierModel;
      return executeMobileClassification(
        query,
        classifierModel
          ? mobileRouteId({
              source: 'local',
              hostId: classifierModel.engine,
              modality: 'classifier',
              modelId: classifierModel.id,
            })
          : undefined,
      );
    },
  });
  logger.log(`[ROUTE-SM] classify intent=${intent} msg="${message.trim().slice(0, 60)}"`);
  return intent;
}
