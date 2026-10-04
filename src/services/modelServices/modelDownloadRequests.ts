import {
  parseImageDownloadMetadata,
} from '@offgrid/models';
import type { PublicDownloadRequest } from '@offgrid/application';
import type { ModelFile } from '../../types';
import { makeModelKey } from '../../utils/modelKey';

export interface MobileTextDownloadMetadata {
  readonly owner: 'mobile-text';
  readonly repositoryId: string;
  readonly file: ModelFile;
}

function isLeafName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value !== '.'
    && value !== '..'
    && !value.includes('/')
    && !value.includes('\\');
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isBoundedString(value: unknown, max = 2_048): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}

function isDownloadUrl(value: unknown): value is string {
  if (!isBoundedString(value, 8_192)) return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function isSafeRelativePath(value: unknown): value is string {
  return isBoundedString(value)
    && !value.startsWith('/')
    && !value.includes('\\')
    && value.split('/').every(part => part.length > 0 && part !== '.' && part !== '..');
}

function isProjector(value: ModelFile['mmProjFile'] | undefined): boolean {
  return value === undefined || (
    isLeafName(value.name)
    && isNonNegativeNumber(value.size)
    && typeof value.downloadUrl === 'string'
    && isOptionalString(value.sha256)
  );
}

function isModelFile(value: unknown): value is ModelFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<ModelFile>;
  return isLeafName(file.name)
    && isNonNegativeNumber(file.size)
    && typeof file.quantization === 'string' && file.quantization.length > 0
    && typeof file.downloadUrl === 'string'
    && isOptionalString(file.sha256)
    && (file.liteRTVision === undefined || typeof file.liteRTVision === 'boolean')
    && (file.liteRTAudio === undefined || typeof file.liteRTAudio === 'boolean')
    && isProjector(file.mmProjFile);
}

export function mobileTextDownloadRequest(
  repositoryId: string,
  file: ModelFile,
): PublicDownloadRequest {
  const modelId = makeModelKey(repositoryId, file.name);
  const metadata: MobileTextDownloadMetadata = {
    owner: 'mobile-text',
    repositoryId,
    file,
  };
  return {
    modelType: 'text',
    modelId,
    modelKey: modelId,
    fileName: file.name,
    url: file.downloadUrl,
    totalBytes: file.size + (file.mmProjFile?.size ?? 0),
    sha256: file.sha256,
    metadataJson: JSON.stringify(metadata),
  };
}

export function mobileTextDownloadMetadata(
  value: string | undefined,
): MobileTextDownloadMetadata | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<MobileTextDownloadMetadata>;
    return parsed.owner === 'mobile-text'
      && typeof parsed.repositoryId === 'string'
      && parsed.repositoryId.length > 0
      && isModelFile(parsed.file)
      ? { owner: 'mobile-text', repositoryId: parsed.repositoryId, file: parsed.file }
      : null;
  } catch {
    return null;
  }
}

type ParsedImageMetadata = NonNullable<ReturnType<typeof parseImageDownloadMetadata>>;

function validImageMetadataHeader(metadata: ParsedImageMetadata): boolean {
  return isBoundedString(metadata.imageModelName)
    && isBoundedString(metadata.imageModelDescription, 16_384)
    && isNonNegativeNumber(metadata.imageModelSize)
    && (metadata.imageModelStyle === undefined || isBoundedString(metadata.imageModelStyle))
    && (metadata.imageModelRepo === undefined || isBoundedString(metadata.imageModelRepo))
    && (metadata.imageModelDownloadUrl === undefined || isDownloadUrl(metadata.imageModelDownloadUrl));
}

function validImageMetadataFiles(metadata: ParsedImageMetadata): boolean {
  const files = metadata.imageModelHuggingFaceFiles ?? metadata.imageModelCoremlFiles;
  if (!files || files.length === 0 || files.length > 512) return false;
  const paths = new Set<string>();
  return files.every(file => {
    const path = file.relativePath ?? file.path;
    const valid = isSafeRelativePath(path)
      && !paths.has(path)
      && isNonNegativeNumber(file.size)
      && (!metadata.imageModelCoremlFiles || isDownloadUrl(file.downloadUrl));
    paths.add(path);
    return valid;
  });
}

/** Validate every nested field Mobile uses before it becomes filesystem or network input. */
export function mobileImageDownloadMetadata(
  value: string | undefined,
): ReturnType<typeof parseImageDownloadMetadata> {
  if (!value || value.length > 1_000_000) return undefined;
  const metadata = parseImageDownloadMetadata(value);
  if (!metadata || !validImageMetadataHeader(metadata)) return undefined;
  if (metadata.imageDownloadType === 'zip') {
    return isDownloadUrl(metadata.imageModelDownloadUrl) ? metadata : undefined;
  }
  return validImageMetadataFiles(metadata) ? metadata : undefined;
}
