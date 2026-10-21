import { loadLlamaModelInfo } from 'llama.rn';
import logger from '../utils/logger';

/**
 * The GGUF header a model publishes about itself, read once per path. `loadLlamaModelInfo` reads
 * the header only (it does not load the model), so this is cheap enough for the load path and the
 * chat screen. A file's header cannot change under us, and an unreadable file is cached as null so
 * a broken path is not re-read on every render.
 */
const cache = new Map<string, Record<string, unknown> | null>();

export async function readModelHeader(modelPath: string | undefined): Promise<Record<string, unknown> | null> {
  if (!modelPath) return null;
  if (cache.has(modelPath)) return cache.get(modelPath) ?? null;
  let header: Record<string, unknown> | null = null;
  try {
    header = (await loadLlamaModelInfo(modelPath)) as Record<string, unknown>;
  } catch (error) {
    logger.warn('[GGUF] could not read model metadata:', error);
  }
  cache.set(modelPath, header);
  return header;
}

/** GGUF `general.file_type` (the dominant quant type), or null when the header has none. */
export async function readModelFileType(modelPath: string | undefined): Promise<number | null> {
  const value = (await readModelHeader(modelPath))?.['general.file_type'];
  const fileType = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  return Number.isFinite(fileType) ? fileType : null;
}
