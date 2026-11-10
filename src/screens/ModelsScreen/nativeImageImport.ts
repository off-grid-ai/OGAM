import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import { modelManager } from '../../services';
import { useAppStore } from '../../stores';
import { AlertState, showAlert } from '../../components/CustomAlert';
import { ONNXImageModel } from '../../types';

type Progress = { fraction: number; fileName: string } | null;
type Deps = {
  setAlertState: (state: AlertState) => void;
  setImportProgress: (progress: Progress) => void;
};

export type ImageFileInfo = { kind: 'image' | 'lora' | 'unsupported' | 'unknown'; family: NonNullable<ONNXImageModel['nativeImageFamily']> };

export async function inspectNativeImageFile(uri: string, name: string): Promise<ImageFileInfo> {
  if (Platform.OS !== 'android' || !NativeModules.LocalDreamModule?.inspectAtlasImageFile) {
    throw new Error('Direct image models require the Android Atlas app.');
  }
  return NativeModules.LocalDreamModule.inspectAtlasImageFile({ uri, fileName: name });
}

/** Keep original weights intact. No conversion, quantization or rewriting. */
export async function importNativeImageFile(uri: string, fileName: string, deps: Deps): Promise<boolean> {
  const module = NativeModules.LocalDreamModule;
  if (Platform.OS !== 'android' || !module?.importAtlasImageFile) {
    deps.setAlertState(showAlert('Unavailable', 'Direct safetensors/GGUF image imports require Android.'));

    return false;
  }
  const info = await inspectNativeImageFile(uri, fileName);
  if (info.kind === 'lora') {
    deps.setAlertState(showAlert('Style add-on', 'This is a LoRA. Open My models, then attach it to a compatible image model.'));
    return false;
  }
  if (info.kind === 'unsupported') {
    deps.setAlertState(showAlert('Unsupported architecture',
      'Pony V7 uses AuraFlow. This native engine does not support AuraFlow yet, so Atlas will not incorrectly import it as SDXL or a language GGUF.'));
    return false;
  }
  if (info.kind !== 'image') {
    deps.setAlertState(showAlert('Unknown model type', 'This file is not recognized as a supported image checkpoint. Atlas will not attempt a potentially incorrect conversion.'));
    return false;
  }
  const name = fileName.replace(/\.(safetensors?|gguf)$/i, '').replace(/[_-]+/g, ' ').trim();
  const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  const modelId = `local_image_${safeName}_${Date.now()}`;
  const modelDir = `${modelManager.getImageModelsDirectory()}/${modelId}`;
  const subscription = new NativeEventEmitter(module).addListener('LocalDreamConvert',
    (event: { stage?: string; fraction?: number }) => {
      if (event.stage === 'copy') {
        deps.setImportProgress({ fraction: Math.min(0.99, Math.max(0, event.fraction ?? 0)), fileName });
      }
    });
  try {
    deps.setImportProgress({ fraction: 0, fileName });
    const r = await module.importAtlasImageFile({ uri, modelDir, fileName });
    if (!r || typeof r.modelDir !== 'string' || !r.modelDir.trim() ||
        !Number.isFinite(Number(r.size)) || Number(r.size) <= 0) {
      throw new Error('Native import did not return a valid model location and file size. Model was not registered.');
    }
    const family = r.family || info.family;
    if (!['sd15', 'sdxl', 'flux', 'z_image', 'anima', 'chroma'].includes(family)) {
      throw new Error('Native import returned an unsupported image architecture. Model was not registered.');
    }
    const model: ONNXImageModel = {
      id: modelId,
      name: name || fileName,
      description: `Original ${fileName.split('.').pop()?.toUpperCase()} image weights (no conversion)`,
      modelPath: r.modelDir,
      backend: 'sdcpp',
      nativeImageFamily: family,
      nativeImageVariant: r.variant === 'turbo' ? 'turbo' : 'base',
      downloadedAt: new Date().toISOString(),
      size: r.size,
      supportFiles: [],
    };
    await modelManager.addDownloadedImageModel(model);
    useAppStore.getState().addDownloadedImageModel(model);
    if (!useAppStore.getState().activeImageModelId) {
      useAppStore.getState().setActiveImageModelId(modelId);
    }
    deps.setAlertState(showAlert('Image model imported', `${name} imported without changing its original weights. Add LoRAs or encoder files in My models.`));
    return true;
  } finally {
    subscription.remove();
    deps.setImportProgress(null);
  }
}
