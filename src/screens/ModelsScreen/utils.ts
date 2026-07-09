import RNFS from 'react-native-fs';
import { guessStyle, HFImageModel } from '../../services/huggingFaceModelBrowser';
import { ModelInfo, ImageModelRecommendation, SoCInfo } from '../../types';
import { ImageModelDescriptor, ModelTypeFilter } from './types';
import { imageBackendLabel } from '../../utils/imageBackend';

// Re-export the canonical byte formatter so existing importers keep working while
// there is only ONE implementation (see src/utils/formatBytes.ts).
export { formatBytes } from '../../utils/formatBytes';

export function formatNumber(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

export async function getDirectorySize(dirPath: string): Promise<number> {
  let total = 0;
  const items = await RNFS.readDir(dirPath);
  for (const item of items) {
    if (item.isDirectory()) {
      total += await getDirectorySize(item.path);
    } else {
      const s = typeof item.size === 'string' ? Number.parseInt(item.size, 10) : (item.size || 0);
      total += s;
    }
  }
  return total;
}

// -- getModelType helpers (extracted to keep complexity per function low) --

function isImageGenModel(tags: string[], name: string, id: string): boolean {
  return (
    tags.some(t => t.includes('diffusion') || t.includes('text-to-image') || t.includes('image-generation') || t.includes('diffusers')) ||
    name.includes('stable-diffusion') || name.includes('sd-') || name.includes('sdxl') ||
    id.includes('stable-diffusion') || id.includes('coreml-stable')
  );
}

function isVisionModel(tags: string[], name: string, id: string): boolean {
  return (
    tags.some(t => t.includes('vision') || t.includes('multimodal') || t.includes('image-text')) ||
    name.includes('vision') || name.includes('vlm') || name.includes('llava') ||
    id.includes('vision') || id.includes('vlm') || id.includes('llava')
  );
}

function isCodeModel(tags: string[], name: string, id: string): boolean {
  return (
    tags.some(t => t.includes('code')) ||
    name.includes('code') || name.includes('coder') || name.includes('starcoder') ||
    id.includes('code') || id.includes('coder')
  );
}

export function getModelType(model: ModelInfo): ModelTypeFilter {
  const tags = model.tags.map(t => t.toLowerCase());
  const name = model.name.toLowerCase();
  const id = model.id.toLowerCase();
  if (isImageGenModel(tags, name, id)) return 'image-gen';
  if (isVisionModel(tags, name, id)) return 'vision';
  if (isCodeModel(tags, name, id)) return 'code';
  return 'text';
}

// -- Text model compatibility helper --

export function isPhiModel(modelName: string, modelId: string): boolean {
  const name = modelName.toLowerCase();
  const id = modelId.toLowerCase();
  return name.includes('phi') || id.includes('phi');
}

export function getTextModelCompatibility(
  model: ModelInfo,
): { isCompatible: boolean; incompatibleReason: string | undefined } {
  if (isPhiModel(model.name, model.id)) {
    return {
      isCompatible: false,
      incompatibleReason: 'Not supported yet',
    };
  }
  return { isCompatible: true, incompatibleReason: undefined };
}

// -- SD version filter helper --

export function matchesSdVersionFilter(modelName: string, sdVersionFilter: string): boolean {
  if (sdVersionFilter === 'all') return true;
  const nameLower = modelName.toLowerCase();
  if (sdVersionFilter === 'sdxl') return nameLower.includes('sdxl') || nameLower.includes('xl');
  if (sdVersionFilter === 'sd21') return nameLower.includes('2.1') || nameLower.includes('2-1');
  if (sdVersionFilter === 'sd15') {
    return nameLower.includes('1.5') || nameLower.includes('1-5') || nameLower.includes('v1-5');
  }
  return true;
}

// -- Image model compatibility helper --

export function getImageModelCompatibility(
  model: HFImageModel,
  imageRec: ImageModelRecommendation | null,
  socInfo?: SoCInfo | null,
): { isCompatible: boolean; incompatibleReason: string | undefined } {
  const backendCompatible =
    !imageRec?.compatibleBackends ||
    imageRec.compatibleBackends.includes(model.backend as any);

  const variantCompatible =
    !model.variant ||
    !imageRec?.qnnVariant ||
    model.variant === imageRec.qnnVariant ||
    imageRec.qnnVariant === '8gen2' ||
    (imageRec.qnnVariant === '8gen1' && model.variant !== '8gen2');

  const isCompatible = backendCompatible && variantCompatible;

  let incompatibleReason: string | undefined;
  if (!backendCompatible) {
    if (socInfo?.vendor === 'qualcomm' && !socInfo.hasNPU) {
      incompatibleReason = 'Requires newer Snapdragon';
    } else {
      incompatibleReason = 'Requires Snapdragon 888+';
    }
  } else if (!variantCompatible) {
    let variantName = model.variant;
    if (model.variant === '8gen2') variantName = 'Snapdragon 8 Gen 2+';
    else if (model.variant === 'min') variantName = 'non-flagship Snapdragon';
    incompatibleReason = `Requires ${variantName}`;
  }

  return { isCompatible, incompatibleReason };
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
    style: guessStyle(hfModel.name),
    backend: hfModel._coreml ? 'coreml' : hfModel.backend,
    variant: hfModel.variant,
    coremlFiles: hfModel._coremlFiles,
    repo: hfModel.repo,
    attentionVariant: hfModel._coremlAttentionVariant,
  };
}
