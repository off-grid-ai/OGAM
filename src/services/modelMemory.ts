/** Mobile GGUF metadata I/O for the shared model-memory calculator. */
import { loadLlamaModelInfo } from 'llama.rn';
import {
  architectureMemoryFromGgufMetadata,
  bytesToMB,
  estimateModelMemory,
  type KvCacheType,
} from '@offgrid/models';
import type { DownloadedModel } from '../types';
import { effectiveCacheType } from './llmHelpers';

interface TextMemorySettings {
  contextLength: number;
  nBatch: number;
  cacheType?: string;
  inferenceBackend?: string;
}

const metadataByPath = new Map<string, Record<string, unknown>>();

function cacheType(value: string): KvCacheType {
  return value === 'f32' || value === 'f16' || value === 'q4_0' || value === 'q8_0'
    ? value
    : 'f16';
}

async function modelMetadata(path: string): Promise<Record<string, unknown> | undefined> {
  const cached = metadataByPath.get(path);
  if (cached) return cached;
  try {
    const metadata = await loadLlamaModelInfo(path) as Record<string, unknown>;
    metadataByPath.set(path, metadata);
    return metadata;
  } catch {
    return undefined;
  }
}

export async function estimateTextModelMemoryMB(
  model: DownloadedModel,
  settings: TextMemorySettings,
): Promise<number> {
  const effectiveCache = cacheType(
    effectiveCacheType(settings.inferenceBackend, settings.cacheType),
  );
  const metadata = model.engine === 'llama'
    ? await modelMetadata(model.filePath)
    : undefined;
  const estimate = estimateModelMemory({
    weightsBytes: model.fileSize,
    projectorBytes: model.engine === 'llama' ? model.mmProjFileSize : undefined,
    contextLength: settings.contextLength,
    batchSize: settings.nBatch,
    keyCacheType: effectiveCache,
    valueCacheType: effectiveCache,
    architecture: metadata
      ? architectureMemoryFromGgufMetadata(metadata)
      : undefined,
  });
  return Math.ceil(bytesToMB(estimate.totalBytes));
}
