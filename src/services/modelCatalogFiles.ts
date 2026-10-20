import { Platform } from 'react-native';
import { prefersQ4_0 } from '@offgrid/models';
import type { ModelFile } from '../types';
import { useAppStore } from '../stores/appStore';
import { huggingFaceService } from './huggingface';
import logger from '../utils/logger';

/** The quants a curated download takes, best first. Android on the CPU or the NPU takes Q4_0 when
 *  the model offers it (llama.cpp repacks it for ARM; HTP runs it natively), else Q4_K_M. */
export function preferredDownloadQuants(): string[] {
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const backend = useAppStore.getState().settings.inferenceBackend;
  return prefersQ4_0(platform, backend) ? ['Q4_0', 'Q4_K_M'] : ['Q4_K_M'];
}

/** Resolve each curated model's preferred file from the catalog boundary. */
export async function fetchModelFiles(models: { id: string }[]): Promise<Record<string, ModelFile[]>> {
  const filesMap: Record<string, ModelFile[]> = {};
  const preferred = preferredDownloadQuants();
  await Promise.all(models.map(async model => {
    try {
      const files = await huggingFaceService.getModelFiles(model.id);
      const file = preferred
        .map(quant => files.find(candidate => candidate.quantization.toUpperCase() === quant))
        .find(Boolean);
      if (file) filesMap[model.id] = [file];
    } catch (error) {
      logger.error(`Error fetching files for ${model.id}:`, error);
    }
  }));
  return filesMap;
}
