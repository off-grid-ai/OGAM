import RNFS from 'react-native-fs';
import type {
  AsyncDownloadedModelRegistryPort,
  DownloadedModelRecord,
} from '@offgrid/models';
import {
  modelPackageIdentity,
  type TransferredModelManifest,
} from '@offgrid/sync';
import {whisperCatalogModelId} from '@offgrid/models';
import { APP_CONFIG } from '../../../constants';
import type { DownloadedModel, ONNXImageModel } from '../../../types';
import {
  commitImageModelsList,
  commitModelsList,
  loadDownloadedImageModels,
  loadDownloadedModels,
} from '../models/library/modelRegistryStorageAdapter';
import type { MobileManagedArtifactIO } from '../../modelServices/modelDownloadArtifactIO';
import {
  getModelPath,
  isModelDownloaded,
  registerTransferredModel,
} from '../../whisperModelFiles';

interface RegistryIdentity {
  registryFamilyId?: string;
  registryPackageIdentity?: string;
  registryFiles?: string[];
  registryKind?: string;
}
type RichModel = (DownloadedModel | ONNXImageModel) & RegistryIdentity;
type RichSnapshot = {
  version: 1;
  kind: 'image' | 'text';
  familyId: string;
  rows: RichModel[];
};
type TranscriptionSnapshot = {
  version: 1;
  kind: 'transcription';
  familyId: string;
};
type Snapshot = RichSnapshot | TranscriptionSnapshot;
type RegistryKind = Snapshot['kind'] | 'voice';

const textRoot = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
const imageRoot = `${RNFS.DocumentDirectoryPath}/image_models`;
const aliases = (familyId: string): string[] => [
  familyId,
  familyId.replace(/^image:/, ''),
];

function registryKind(kind: string): RegistryKind {
  if (kind === 'image') return 'image';
  if (kind === 'voice') return 'voice';
  if (kind === 'transcription') return 'transcription';
  if (kind === 'text' || kind === 'vision' || kind === 'computer_use')
    return 'text';
  throw new Error(`Mobile downloaded-model registry does not support ${kind}.`);
}

function belongs(model: RichModel, familyId: string): boolean {
  if (model.registryFamilyId === familyId) return true;
  const candidates = aliases(familyId);
  if (candidates.includes(model.id)) return true;
  return (
    'fileName' in model &&
    candidates.some(id => model.id === `${id}/${model.fileName}`)
  );
}

async function rows(kind: Snapshot['kind']): Promise<RichModel[]> {
  return kind === 'image'
    ? ((await loadDownloadedImageModels(imageRoot)) as RichModel[])
    : ((await loadDownloadedModels(textRoot)) as RichModel[]);
}

async function write(
  kind: Snapshot['kind'],
  models: RichModel[],
): Promise<void> {
  if (kind === 'image') await commitImageModelsList(models as ONNXImageModel[]);
  else await commitModelsList(models as DownloadedModel[]);
}

function projected(model: RichModel): DownloadedModelRecord | null {
  if (!model.registryFamilyId || !model.registryFiles || !model.registryKind)
    return null;
  return {
    id: model.registryPackageIdentity ?? model.id,
    familyId: model.registryFamilyId,
    ...(model.registryPackageIdentity
      ? { packageIdentity: model.registryPackageIdentity }
      : {}),
    name: model.name,
    kind: model.registryKind,
    files: [...model.registryFiles],
  };
}

function decodeSnapshot(value: string): Snapshot {
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== 'object')
    throw new Error('Mobile registry snapshot is invalid.');
  const snapshot = parsed as Partial<Snapshot>;
  if (
    snapshot.version !== 1 ||
    typeof snapshot.familyId !== 'string' ||
    (snapshot.kind !== 'transcription' &&
      ((snapshot.kind !== 'image' && snapshot.kind !== 'text') ||
        !Array.isArray(snapshot.rows)))
  ) {
    throw new Error('Mobile registry snapshot is invalid.');
  }
  return snapshot as Snapshot;
}

function transcriptionModel(record: DownloadedModelRecord): {
  modelId: string;
  path: string;
} {
  const file = record.files.find(candidate =>
    /^whisper-models\/ggml-[^/]+\.bin$/.test(candidate),
  );
  if (!file)
    throw new Error(
      'Downloaded transcription record has no canonical Whisper file.',
    );
  const modelId = file.slice('whisper-models/ggml-'.length, -'.bin'.length);
  return { modelId, path: getModelPath(modelId) };
}

async function installedSize(relativePath: string): Promise<number> {
  if (
    !relativePath ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.split('/').some(part => !part || part === '.' || part === '..')
  )
    return 0;
  try {
    const entry = await RNFS.stat(
      `${RNFS.DocumentDirectoryPath}/${relativePath}`,
    );
    if (entry.isFile()) return Number(entry.size) || 0;
    if (!entry.isDirectory()) return 0;
    const children = await RNFS.readDir(
      `${RNFS.DocumentDirectoryPath}/${relativePath}`,
    );
    return (
      await Promise.all(
        children.map(child => installedSize(`${relativePath}/${child.name}`)),
      )
    ).reduce((sum, size) => sum + size, 0);
  } catch {
    return 0;
  }
}

let transactionTail = Promise.resolve();
async function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const previous = transactionTail;
  let release!: () => void;
  transactionTail = new Promise<void>(resolve => {
    release = resolve;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

/** Mobile owns rich-registry I/O only. Shared owns transaction and registration policy. */
export function createMobileDownloadedModelRegistryAdapter(
  managed?: MobileManagedArtifactIO,
): AsyncDownloadedModelRegistryPort {
  const managedRegistry = managed?.downloadedRegistry;
  return {
    capture: input =>
      serialized(async () => {
        const kind = registryKind(input.kind);
        if (kind === 'voice') {
          if (!managedRegistry)
            throw new Error('Managed voice registry is not configured.');
          return managedRegistry.capture(input);
        }
        if (kind === 'transcription') {
          return JSON.stringify({
            version: 1,
            kind,
            familyId: input.familyId,
          } satisfies TranscriptionSnapshot);
        }
        return JSON.stringify({
          version: 1,
          kind,
          familyId: input.familyId,
          rows: (await rows(kind)).filter(model =>
            belongs(model, input.familyId),
          ),
        } satisfies Snapshot);
      }),
    apply: intent =>
      serialized(async () => {
        const kind = registryKind(intent.record.kind);
        if (kind === 'voice') {
          if (!managedRegistry)
            throw new Error('Managed voice registry is not configured.');
          return managedRegistry.apply(intent);
        }
        if (kind === 'transcription') {
          const model = transcriptionModel(intent.record);
          await registerTransferredModel(model.path, model.modelId);
          return;
        }
        const current = await rows(kind);
        const index = current.findIndex(model =>
          belongs(model, intent.record.familyId ?? intent.record.id),
        );
        if (index < 0)
          throw new Error(
            'Downloaded model has no canonical Mobile registry row.',
          );
        const model = { ...current[index] };
        model.registryFamilyId = intent.record.familyId ?? intent.record.id;
        model.registryPackageIdentity = intent.record.packageIdentity;
        model.registryFiles = [...intent.record.files];
        model.registryKind = intent.record.kind;
        await write(kind, [
          ...current.slice(0, index),
          model,
          ...current.slice(index + 1),
        ]);
      }),
    restore: snapshotValue =>
      serialized(async () => {
        const parsed = JSON.parse(snapshotValue) as { kind?: unknown };
        if (parsed.kind === 'voice') {
          if (!managedRegistry)
            throw new Error('Managed voice registry is not configured.');
          return managedRegistry.restore(snapshotValue);
        }
        const snapshot = decodeSnapshot(snapshotValue);
        if (snapshot.kind === 'transcription') return;
        const current = await rows(snapshot.kind);
        await write(snapshot.kind, [
          ...current.filter(model => !belongs(model, snapshot.familyId)),
          ...snapshot.rows,
        ]);
      }),
    contains: async intent => {
      const kind = registryKind(intent.record.kind);
      if (kind === 'voice') {
        return managedRegistry?.contains(intent) ?? false;
      }
      if (kind === 'transcription') {
        return isModelDownloaded(transcriptionModel(intent.record).modelId);
      }
      const current = await rows(kind);
      return current.some(model => {
        const record = projected(model);
        return (
          record?.id === intent.record.id &&
          record.familyId === intent.record.familyId &&
          record.files.join('\0') === intent.record.files.join('\0')
        );
      });
    },
    fileSize: relativePath =>
      managed?.ownsPath(relativePath)
        ? managed.size(relativePath)
        : installedSize(relativePath),
    containsInstalledFamily: async input => {
      const kind = registryKind(input.kind);
      if (kind === 'voice') {
        return (
          managedRegistry?.contains({
            record: {
              id: input.familyId,
              familyId: input.familyId,
              name: input.familyId,
              kind: input.kind,
              files: [],
            },
          }) ?? false
        );
      }
      if (kind === 'transcription') {
        const file = input.artifactNames
          .map(name => name.split('/').at(-1) ?? '')
          .find(name => /^ggml-.+\.bin$/i.test(name));
        return file ? isModelDownloaded(whisperCatalogModelId(file)) : false;
      }
      return (await rows(kind)).some(model => belongs(model, input.familyId));
    },
    packageIdentity: input =>
      modelPackageIdentity({
        ...input,
        files: input.files as TransferredModelManifest['files'],
      }),
  };
}
