/**
 * Memory check helpers for ActiveModelService.
 * All functions are pure/standalone — they receive state via parameter objects.
 */

import { DownloadedModel, ONNXImageModel } from '../../types';
import { hardwareService } from '../hardware';
import { llmService } from '../llm';
import { liteRTService } from '../litert';
import {
  ModelType,
  MemoryCheckResult,
  MemoryCheckSeverity,
  TEXT_MODEL_OVERHEAD_MULTIPLIER,
  IMAGE_MODEL_OVERHEAD_MULTIPLIER,
} from './types';
import { modelMemoryBudgetMB, modelWarningThresholdMB } from '../memoryBudget';

// ---------------------------------------------------------------------------
// Budget helpers
// ---------------------------------------------------------------------------

export const getMemoryBudgetGB = async (): Promise<number> => {
  const deviceInfo = await hardwareService.getDeviceInfo();
  const totalMB = deviceInfo.totalMemory / (1024 * 1024);
  return modelMemoryBudgetMB(totalMB) / 1024;
};

export const getMemoryWarningThresholdGB = async (): Promise<number> => {
  const deviceInfo = await hardwareService.getDeviceInfo();
  const totalMB = deviceInfo.totalMemory / (1024 * 1024);
  return modelWarningThresholdMB(totalMB) / 1024;
};

// ---------------------------------------------------------------------------
// Size estimators
// ---------------------------------------------------------------------------

export function estimateModelMemoryGB(
  model: DownloadedModel | ONNXImageModel,
  type: ModelType,
): number {
  if (type === 'text') {
    const textModel = model as DownloadedModel;
    const sizeGB = (textModel.fileSize || 0) / (1024 * 1024 * 1024);
    return sizeGB * TEXT_MODEL_OVERHEAD_MULTIPLIER;
  }
  const imageModel = model as ONNXImageModel;
  const sizeGB = (imageModel.size || 0) / (1024 * 1024 * 1024);
  return sizeGB * IMAGE_MODEL_OVERHEAD_MULTIPLIER;
}

export interface LoadedModelIds {
  loadedTextModelId: string | null;
  loadedImageModelId: string | null;
}

export interface ModelLists {
  downloadedModels: DownloadedModel[];
  downloadedImageModels: ONNXImageModel[];
}

export function getCurrentlyLoadedMemoryGB(
  ids: LoadedModelIds,
  lists: ModelLists,
): number {
  let totalGB = 0;

  if (ids.loadedTextModelId && (llmService.isModelLoaded() || liteRTService.isModelLoaded())) {
    const textModel = lists.downloadedModels.find(m => m.id === ids.loadedTextModelId);
    if (textModel) {
      totalGB += estimateModelMemoryGB(textModel, 'text');
    }
  }

  if (ids.loadedImageModelId) {
    const imageModel = lists.downloadedImageModels.find(
      m => m.id === ids.loadedImageModelId,
    );
    if (imageModel) {
      totalGB += estimateModelMemoryGB(imageModel, 'image');
    }
  }

  return totalGB;
}

/** Memory used by OTHER models already loaded (not the one being replaced). */
export function getOtherLoadedMemoryGB(
  modelType: ModelType,
  ids: LoadedModelIds,
  lists: ModelLists,
): number {
  let totalGB = 0;
  if (modelType === 'text' && ids.loadedImageModelId) {
    const imageModel = lists.downloadedImageModels.find(
      m => m.id === ids.loadedImageModelId,
    );
    if (imageModel) {
      totalGB += estimateModelMemoryGB(imageModel, 'image');
    }
  }
  if (modelType === 'image' && ids.loadedTextModelId && (llmService.isModelLoaded() || liteRTService.isModelLoaded())) {
    const textModel = lists.downloadedModels.find(m => m.id === ids.loadedTextModelId);
    if (textModel) {
      totalGB += estimateModelMemoryGB(textModel, 'text');
    }
  }
  return totalGB;
}

// ---------------------------------------------------------------------------
// checkMemoryForModel
// ---------------------------------------------------------------------------

export interface CheckMemoryParams {
  modelId: string;
  modelType: ModelType;
  ids: LoadedModelIds;
  lists: ModelLists;
}

export async function checkMemoryForModel(
  params: CheckMemoryParams,
): Promise<MemoryCheckResult> {
  const { modelId, modelType, ids, lists } = params;
  const memoryBudgetGB = await getMemoryBudgetGB();
  const warningThresholdGB = await getMemoryWarningThresholdGB();

  const model =
    modelType === 'text'
      ? lists.downloadedModels.find(m => m.id === modelId)
      : lists.downloadedImageModels.find(m => m.id === modelId);

  if (!model) {
    return {
      canLoad: false,
      severity: 'blocked',
      availableMemoryGB: 0,
      requiredMemoryGB: 0,
      currentlyLoadedMemoryGB: 0,
      totalRequiredMemoryGB: 0,
      remainingAfterLoadGB: 0,
      message: 'Model not found',
    };
  }

  const requiredMemoryGB = estimateModelMemoryGB(model, modelType);
  const currentlyLoadedMemoryGB = getOtherLoadedMemoryGB(modelType, ids, lists);
  const totalRequiredMemoryGB = requiredMemoryGB + currentlyLoadedMemoryGB;
  const remainingBudgetGB = memoryBudgetGB - totalRequiredMemoryGB;

  const modelName = 'name' in model ? model.name : modelId;
  const requiredStr = requiredMemoryGB.toFixed(1);
  const totalStr = totalRequiredMemoryGB.toFixed(1);
  const budgetStr = memoryBudgetGB.toFixed(1);

  let severity: MemoryCheckSeverity;
  let canLoad: boolean;
  let message: string;

  if (totalRequiredMemoryGB > memoryBudgetGB) {
    severity = 'critical';
    canLoad = false;
    message =
      currentlyLoadedMemoryGB > 0
        ? `Cannot load ${modelName} (~${requiredStr} GB) while other models are loaded. ` +
          `Total would be ~${totalStr} GB, exceeding your device's ~${budgetStr} GB safe limit. ` +
          `Unload the other model first, or choose a smaller model.`
        : `${modelName} requires ~${requiredStr} GB which exceeds your device's ~${budgetStr} GB safe limit. ` +
          `This model is too large for your device. Choose a smaller model.`;
  } else if (totalRequiredMemoryGB > warningThresholdGB) {
    severity = 'warning';
    canLoad = true;
    message =
      `Loading ${modelName} will use ~${requiredStr} GB. ` +
      `Total model memory will be ~${totalStr} GB, near your device's safe limit. ` +
      `The app may become slow. Continue anyway?`;
  } else {
    severity = 'safe';
    canLoad = true;
    message = `${modelName} requires ~${requiredStr} GB. Safe to load.`;
  }

  return {
    canLoad,
    severity,
    availableMemoryGB: memoryBudgetGB - currentlyLoadedMemoryGB,
    requiredMemoryGB,
    currentlyLoadedMemoryGB,
    totalRequiredMemoryGB,
    remainingAfterLoadGB: remainingBudgetGB,
    message,
  };
}

// ---------------------------------------------------------------------------
// checkMemoryForDualModel
// ---------------------------------------------------------------------------

export interface CheckDualMemoryParams {
  textModelId: string | null;
  imageModelId: string | null;
  lists: ModelLists;
}

export async function checkMemoryForDualModel(
  params: CheckDualMemoryParams,
): Promise<MemoryCheckResult> {
  const { textModelId, imageModelId, lists } = params;
  const memoryBudgetGB = await getMemoryBudgetGB();
  const warningThresholdGB = await getMemoryWarningThresholdGB();

  let totalRequiredGB = 0;
  const modelNames: string[] = [];

  if (textModelId) {
    const textModel = lists.downloadedModels.find(m => m.id === textModelId);
    if (textModel) {
      totalRequiredGB += estimateModelMemoryGB(textModel, 'text');
      modelNames.push(textModel.name);
    }
  }

  if (imageModelId) {
    const imageModel = lists.downloadedImageModels.find(m => m.id === imageModelId);
    if (imageModel) {
      totalRequiredGB += estimateModelMemoryGB(imageModel, 'image');
      modelNames.push(imageModel.name);
    }
  }

  const remainingBudgetGB = memoryBudgetGB - totalRequiredGB;
  const namesStr = modelNames.join(' + ');
  const requiredStr = totalRequiredGB.toFixed(1);
  const budgetStr = memoryBudgetGB.toFixed(1);

  let severity: MemoryCheckSeverity;
  let canLoad: boolean;
  let message: string;

  if (totalRequiredGB > memoryBudgetGB) {
    severity = 'critical';
    canLoad = false;
    message =
      `Cannot load both models. ` +
      `${namesStr} would require ~${requiredStr} GB, exceeding your device's ~${budgetStr} GB safe limit.`;
  } else if (totalRequiredGB > warningThresholdGB) {
    severity = 'warning';
    canLoad = true;
    message =
      `Loading ${namesStr} will use ~${requiredStr} GB, near your device's safe limit. ` +
      `Performance may be affected.`;
  } else {
    severity = 'safe';
    canLoad = true;
    message = `${namesStr} will use ~${requiredStr} GB. Safe to load.`;
  }

  return {
    canLoad,
    severity,
    availableMemoryGB: memoryBudgetGB,
    requiredMemoryGB: totalRequiredGB,
    currentlyLoadedMemoryGB: 0,
    totalRequiredMemoryGB: totalRequiredGB,
    remainingAfterLoadGB: remainingBudgetGB,
    message,
  };
}
