import type { DevicePlatform, TransferredModelManifest } from '@offgrid/sync';
import type { ONNXImageModel } from '../../types';

const IMAGE_TRANSFER_ARCHIVE_SUFFIX = '.offgrid-image.zip';

type MobileImagePlatform = Extract<DevicePlatform, 'ios' | 'android'>;
type TransferableImageBackend = Extract<
  NonNullable<ONNXImageModel['backend']>,
  'coreml' | 'mnn' | 'sd'
>;

export interface TransferredImageDescriptor {
  version: 1;
  backend: TransferableImageBackend;
  description: string;
  uncompressedSizeBytes: number;
  style?: string;
  attentionVariant?: ONNXImageModel['attentionVariant'];
}

export interface TransferredImageManifest extends TransferredModelManifest {
  kind: 'image';
  engine: 'coreml' | 'localdream-mnn' | 'mobile-sd-gguf';
  platform: MobileImagePlatform;
  image: TransferredImageDescriptor;
}

function isSafeImageModelId(id: string): boolean {
  return (
    id.length > 0 &&
    id.length <= 160 &&
    id !== '.' &&
    id !== '..' &&
    !id.includes('/') &&
    !id.includes('\\')
  );
}

function expectedImageRuntime(platform: MobileImagePlatform, backend?: ONNXImageModel['backend']): {
  backend: TransferableImageBackend;
  engine: TransferredImageManifest['engine'];
} {
  if (backend === 'sd') return { backend: 'sd', engine: 'mobile-sd-gguf' };
  return platform === 'ios'
    ? { backend: 'coreml', engine: 'coreml' }
    : { backend: 'mnn', engine: 'localdream-mnn' };
}

/**
 * Why an installed image model may or may not move from this phone.
 *
 * SD image packs work on both mobile platforms. Core ML and LocalDream MNN packages
 * stay on their original platform. QNN is intentionally excluded because an Android label
 * does not prove that the receiving device has the matching Qualcomm target.
 */
export function imageModelTransferBlocker(
  model: ONNXImageModel,
  platform: MobileImagePlatform,
): string | null {
  if (!isSafeImageModelId(model.id)) {
    return 'the image model identity is not safe to transfer';
  }
  const expected = expectedImageRuntime(platform, model.backend);
  if (model.backend !== expected.backend) {
    if (model.backend === 'qnn') {
      return 'QNN image models are tied to a specific Qualcomm target and cannot be sent safely';
    }
    return platform === 'ios'
      ? 'iPhone and iPad can send only Core ML image models'
      : 'Android can send only LocalDream MNN image models';
  }
  if (model.backend === 'sd' && !model.id.startsWith('sd-')) return 'this image model pack is not supported';
  if (!Number.isFinite(model.size) || model.size <= 0) {
    return 'the image model size is not valid';
  }
  return null;
}

/** Keep ZIP staging scoped to one installed model, never the whole store or a sibling. */
export function imageModelPathBlocker(
  model: Pick<ONNXImageModel, 'id' | 'modelPath'>,
  imageModelsRoot: string,
): string | null {
  if (!isSafeImageModelId(model.id)) {
    return 'the image model identity is not safe to transfer';
  }
  if (model.modelPath.split('/').some(part => part === '.' || part === '..')) {
    return 'the image model path contains traversal segments';
  }
  const root = imageModelsRoot.replace(/\/+$/, '');
  const dedicated = `${root}/${model.id}`;
  if (
    model.modelPath !== dedicated &&
    !model.modelPath.startsWith(`${dedicated}/`)
  ) {
    return 'the image model is outside its dedicated app model directory';
  }
  return null;
}

export function imageTransferArchiveName(modelId: string): string {
  if (!isSafeImageModelId(modelId)) {
    throw new Error('the image model identity is not safe to transfer');
  }
  return `${modelId}${IMAGE_TRANSFER_ARCHIVE_SUFFIX}`;
}

/** The wire manifest for one native-streamed archive of an installed image-model directory. */
export function transferredImageManifest(
  model: ONNXImageModel,
  platform: MobileImagePlatform,
  archiveSizeBytes: number,
): TransferredImageManifest {
  const blocker = imageModelTransferBlocker(model, platform);
  if (blocker) throw new Error(blocker);
  if (!Number.isSafeInteger(archiveSizeBytes) || archiveSizeBytes <= 0) {
    throw new Error('the image model archive size is not valid');
  }
  const runtime = expectedImageRuntime(platform, model.backend);
  return {
    id: model.id,
    name: model.name,
    kind: 'image',
    source: 'downloaded',
    engine: runtime.engine,
    platform,
    files: [
      {
        name: imageTransferArchiveName(model.id),
        sizeBytes: archiveSizeBytes,
        role: 'primary',
      },
    ],
    image: {
      version: 1,
      backend: runtime.backend,
      description: model.description,
      uncompressedSizeBytes: model.size,
      ...(model.style ? { style: model.style } : {}),
      ...(model.attentionVariant
        ? { attentionVariant: model.attentionVariant }
        : {}),
    },
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Receiver-owned image runtime gate.
 *
 * Shared sync proves that the sender and receiver platforms match. This adapter also proves that
 * the archive declares the exact runtime and registry fields this app will use after extraction.
 */
export function transferredImageDescriptor(
  manifest: TransferredModelManifest,
  receiverPlatform: MobileImagePlatform,
): TransferredImageDescriptor {
  if (manifest.kind !== 'image') {
    throw new Error('this is not an image model package');
  }
  const sdPack = manifest.engine === 'mobile-sd-gguf';
  if (sdPack && !manifest.id.startsWith('sd-')) throw new Error('This image model pack is not supported.');
  const expected = expectedImageRuntime(receiverPlatform, sdPack ? 'sd' : undefined);
  if (
    (!sdPack && manifest.platform !== receiverPlatform) ||
    manifest.engine !== expected.engine
  ) {
    throw new Error(
      receiverPlatform === 'ios'
        ? 'this iPhone or iPad requires an iOS Core ML image model package'
        : 'this Android device requires an Android LocalDream MNN image model package',
    );
  }
  if (!isSafeImageModelId(manifest.id)) {
    throw new Error('the image model identity is not safe to install');
  }
  if (
    manifest.files.length !== 1 ||
    manifest.files[0].role !== 'primary' ||
    manifest.files[0].name !== imageTransferArchiveName(manifest.id)
  ) {
    throw new Error(
      'an image model transfer requires one Off Grid image archive',
    );
  }
  const image = record((manifest as { image?: unknown }).image);
  if (
    image?.version !== 1 ||
    image.backend !== expected.backend ||
    typeof image.description !== 'string' ||
    !Number.isSafeInteger(image.uncompressedSizeBytes) ||
    Number(image.uncompressedSizeBytes) <= 0 ||
    (image.style !== undefined && typeof image.style !== 'string') ||
    (image.attentionVariant !== undefined &&
      image.attentionVariant !== 'split_einsum' &&
      image.attentionVariant !== 'original')
  ) {
    throw new Error('the image model transfer descriptor is invalid');
  }
  return image as unknown as TransferredImageDescriptor;
}
