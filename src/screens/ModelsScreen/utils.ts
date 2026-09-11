import { HFImageModel } from '../../services/huggingFaceModelBrowser';
import { ModelInfo, ImageModelRecommendation, SoCInfo } from '../../types';
import { ImageModelDescriptor, ModelTypeFilter } from './types';
import { imageBackendLabel } from '../../utils/imageBackend';
export { getDirectorySize } from '../../services/adapters/filesystem/directorySize';
import {
  getModelType as sharedModelType,
  imageCatalogCompatibility,
  imageCatalogStyle,
  matchesStableDiffusionVersion,
  textCatalogCompatibility,
} from '@offgrid/application';

// Re-export the canonical byte formatter so existing importers keep working while
// there is only ONE implementation (see src/utils/formatBytes.ts).
export { formatBytes } from '../../utils/formatBytes';

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

export function getModelType(model: ModelInfo): ModelTypeFilter {
  return sharedModelType(model.name, model.tags, model.id);
}

// -- Text model compatibility helper --

export function getTextModelCompatibility(
  model: ModelInfo,
): { isCompatible: boolean; incompatibleReason: string | undefined } {
  const result = textCatalogCompatibility(model);
  return { isCompatible: result.compatible, incompatibleReason: result.reason ? 'Not supported yet' : undefined };
}

// -- SD version filter helper --

export function matchesSdVersionFilter(modelName: string, sdVersionFilter: string): boolean {
  return matchesStableDiffusionVersion(modelName, sdVersionFilter);
}

// -- Image model compatibility helper --

export function getImageModelCompatibility(
  model: HFImageModel,
  imageRec: ImageModelRecommendation | null,
  socInfo?: SoCInfo | null,
): { isCompatible: boolean; incompatibleReason: string | undefined } {
  const result = imageCatalogCompatibility({
    model,
    recommendation: imageRec,
    qualcomm: socInfo?.vendor === 'qualcomm',
    hasNpu: socInfo?.hasNPU,
  });
  const reason = result.reason === 'backend_requires_newer_snapdragon'
    ? 'Requires newer Snapdragon'
    : result.reason === 'backend_requires_snapdragon_888'
      ? 'Requires Snapdragon 888+'
      : result.reason === 'variant_requires_8gen2'
        ? 'Requires Snapdragon 8 Gen 2+'
        : result.reason === 'variant_requires_non_flagship'
          ? 'Requires non-flagship Snapdragon'
          : result.reason ? `Requires ${result.variant}` : undefined;
  return { isCompatible: result.compatible, incompatibleReason: reason };
}

// -- HF model → descriptor conversion --

export function hfModelToDescriptor(
  hfModel: HFImageModel & { _coreml?: boolean; _coremlFiles?: any[]; _coremlAttentionVariant?: 'split_einsum' | 'original' },
): ImageModelDescriptor {
  return {
    id: hfModel.id,
    name: hfModel.displayName,
    description: (() => {
      if (hfModel._coreml) return `Core ML model from ${hfModel.repo}`;
      return `${imageBackendLabel(hfModel.backend, 'GPU')} model from ${hfModel.repo}`;
    })(),
    downloadUrl: hfModel.downloadUrl,
    size: hfModel.size,
    style: imageCatalogStyle(hfModel.name),
    backend: hfModel._coreml ? 'coreml' : hfModel.backend,
    variant: hfModel.variant,
    coremlFiles: hfModel._coremlFiles,
    repo: hfModel.repo,
    attentionVariant: hfModel._coremlAttentionVariant,
  };
}
