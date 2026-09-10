import type { ModelFile } from '../types';
import { CATALOG, type ModelEntry } from '@offgrid/models/catalog';
import { extractQuantization } from '@offgrid/models';
import logger from '../utils/logger';

export interface ModelFileDiscoveryPort {
  getModelFiles(modelId: string): Promise<ModelFile[]>;
}

/**
 * Project a Shared catalog entry into the Mobile file-card contract.
 *
 * `null` means that Shared does not own this model identity. An empty array means
 * that Shared owns the identity but does not publish a downloadable primary
 * artifact. Keeping those states distinct prevents a catalog entry from silently
 * falling through to network discovery.
 */
export function catalogModelFiles(
  modelId: string,
  catalog: readonly ModelEntry[] = CATALOG,
): ModelFile[] | null {
  const model = catalog.find(entry => entry.id === modelId);
  if (!model) return null;

  const projector = model.files.find(file => file.role === 'mmproj');
  return model.files
    .filter(file => file.role === 'primary' || file.role === undefined)
    .map(file => ({
      name: file.name,
      size: file.sizeBytes ?? 0,
      quantization: extractQuantization(file.name),
      downloadUrl: file.url,
      sha256: file.sha256,
      ...(projector
        ? {
            mmProjFile: {
              name: projector.name,
              size: projector.sizeBytes ?? 0,
              downloadUrl: projector.url,
              sha256: projector.sha256,
            },
          }
        : {}),
    }));
}

/**
 * Resolve every downloadable variant for a repository-backed model.
 *
 * Shared catalog files remain the trusted fallback and override matching remote
 * metadata. Remote discovery adds the other quantizations that the catalog does
 * not need to duplicate. Runtime-owned entries have no catalog files and must
 * never fall through to Hugging Face.
 */
export async function resolveModelFiles(
  modelId: string,
  discovery: ModelFileDiscoveryPort,
): Promise<ModelFile[]> {
  const catalogFiles = catalogModelFiles(modelId);
  if (catalogFiles?.length === 0) return [];

  if (catalogFiles === null) return discovery.getModelFiles(modelId);

  try {
    const discoveredFiles = await discovery.getModelFiles(modelId);
    if (discoveredFiles.length === 0) return catalogFiles;

    const catalogByName = new Map(
      catalogFiles.map(file => [file.name, file] as const),
    );
    const discoveredNames = new Set(discoveredFiles.map(file => file.name));
    return [
      ...discoveredFiles.map(file => ({
        ...file,
        ...catalogByName.get(file.name),
      })),
      ...catalogFiles.filter(file => !discoveredNames.has(file.name)),
    ];
  } catch (error) {
    logger.warn(`Could not discover model variants for ${modelId}:`, error);
    return catalogFiles;
  }
}

/** Resolve each curated model's standard Q4_K_M file from the catalog boundary. */
export async function fetchModelFiles(
  models: { id: string }[],
  discovery: ModelFileDiscoveryPort,
): Promise<Record<string, ModelFile[]>> {
  const filesMap: Record<string, ModelFile[]> = {};
  await Promise.all(models.map(async model => {
    try {
      const files = await resolveModelFiles(model.id, discovery);
      const file = files.find(candidate => candidate.quantization.toUpperCase() === 'Q4_K_M');
      if (file) filesMap[model.id] = [file];
    } catch (error) {
      logger.error(`Error fetching files for ${model.id}:`, error);
    }
  }));
  return filesMap;
}
