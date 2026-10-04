import {
  createImageDownloadPlan,
  imageDownloadDescriptorFromMetadata,
  isGgufFile,
  isModelProjectorFile,
  pickProjectorForDownload,
  type ImageDownloadDescriptor,
} from '@offgrid/models';
import type {
  ModelControlCatalogModel,
  ModelControlDownloadSelection,
  ModelsControlPlatformPort,
} from '@offgrid/application';
import { mobileImageDownloadMetadata } from '../../modelServices/modelDownloadRequests';

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Model catalog request was cancelled.');
}

interface HuggingFaceSibling {
  readonly rfilename: string;
  readonly size?: number;
  readonly lfs?: {
    readonly size?: number;
    readonly oid?: string;
    readonly sha256?: string;
  };
}

interface HuggingFaceRepositoryFacts {
  readonly siblings?: readonly HuggingFaceSibling[];
}

const artifactUrl = (repositoryId: string, fileName: string): string =>
  `https://huggingface.co/${repositoryId}/resolve/main/${fileName}`;

const exactSize = (file: HuggingFaceSibling): number | undefined =>
  file.lfs?.size ?? file.size;

async function repositoryFiles(
  repositoryId: string,
  signal: AbortSignal,
): Promise<readonly HuggingFaceSibling[]> {
  const response = await fetch(
    `https://huggingface.co/api/models/${repositoryId}?blobs=true`,
    { signal, headers: { Accept: 'application/json' } },
  );
  if (!response.ok) return [];
  const facts = (await response.json()) as HuggingFaceRepositoryFacts;
  return facts.siblings ?? [];
}

async function resolveRepositorySelection(
  modelId: string,
  selection: ModelControlDownloadSelection,
  signal: AbortSignal,
): Promise<ModelControlCatalogModel | null> {
  const files = await repositoryFiles(selection.repositoryId, signal);
  const primary = files.find(file => file.rfilename === selection.fileName);
  if (!primary) return null;
  const projectorName = isGgufFile(selection.fileName)
    ? pickProjectorForDownload(
        selection.fileName,
        files
          .filter(file => isModelProjectorFile(file.rfilename))
          .map(file => file.rfilename),
      )
    : undefined;
  const projector = projectorName
    ? files.find(file => file.rfilename === projectorName)
    : undefined;
  const transcription = selection.fileName.endsWith('.bin');
  return {
    id: modelId,
    name: selection.repositoryId.split('/').at(-1) ?? selection.repositoryId,
    kind: transcription ? 'transcription' : 'text',
    catalogEntry: false,
    artifacts: [
      {
        name: primary.rfilename,
        role: 'primary',
        url: artifactUrl(selection.repositoryId, primary.rfilename),
        ...(exactSize(primary) === undefined
          ? {}
          : { sizeBytes: exactSize(primary) }),
        ...(primary.lfs?.sha256 ? { sha256: primary.lfs.sha256 } : {}),
      },
      ...(projector
        ? [
            {
              name: projector.rfilename,
              role: 'mmproj' as const,
              url: artifactUrl(selection.repositoryId, projector.rfilename),
              ...(exactSize(projector) === undefined
                ? {}
                : { sizeBytes: exactSize(projector) }),
              ...(projector.lfs?.sha256
                ? { sha256: projector.lfs.sha256 }
                : {}),
            },
          ]
        : []),
    ],
  };
}

function imageSourceFileName(model: ImageDownloadDescriptor): string | null {
  const plan = createImageDownloadPlan(model);
  if (plan.artifacts.length > 0) return plan.artifacts[0]?.relativePath ?? null;
  try {
    const marker = '/resolve/main/';
    const pathname = new URL(model.downloadUrl).pathname;
    const index = pathname.indexOf(marker);
    return index < 0
      ? null
      : decodeURIComponent(pathname.slice(index + marker.length));
  } catch {
    return null;
  }
}

export function mobileImageDownloadSelection(
  model: ImageDownloadDescriptor,
): ModelControlDownloadSelection | null {
  const repositoryId = model.repo ?? model.huggingFaceRepo;
  const fileName = imageSourceFileName(model);
  return repositoryId && fileName ? { repositoryId, fileName } : null;
}

async function resolveImageSelection(
  modelId: string,
  selection: ModelControlDownloadSelection,
  loadImageModels: () => Promise<readonly ImageDownloadDescriptor[]>,
): Promise<ModelControlCatalogModel | null> {
  const metadata = mobileImageDownloadMetadata(selection.metadataJson);
  const descriptor = metadata
    ? imageDownloadDescriptorFromMetadata(modelId, metadata)
    : (await loadImageModels()).find(model => model.id === modelId);
  if (!descriptor) return null;
  const plan = createImageDownloadPlan(descriptor);
  const artifacts =
    plan.artifacts.length > 0
      ? plan.artifacts.map(artifact => ({
          name: artifact.relativePath,
          role:
            artifact.relativePath === selection.fileName
              ? ('primary' as const)
              : ('aux' as const),
          url: artifact.url,
          sizeBytes: artifact.size,
        }))
      : [
          {
            name: selection.fileName,
            role: 'primary' as const,
            url: descriptor.downloadUrl,
            sizeBytes: descriptor.size,
          },
        ];
  if (!artifacts.some(artifact => artifact.name === selection.fileName))
    return null;
  return {
    id: modelId,
    name: descriptor.name,
    kind: 'image',
    catalogEntry: false,
    artifacts,
  };
}

/** Mobile supplies remote catalog facts. Shared owns selection, admission and lifecycle. */
export function createMobileModelControlPort(
  loadImageModels: () => Promise<readonly ImageDownloadDescriptor[]>,
): ModelsControlPlatformPort {
  return {
    catalog: {
      read: async signal => {
        throwIfAborted(signal);
        return { kinds: [], models: [] };
      },
      resolve: async (modelId, signal, selection) => {
        throwIfAborted(signal);
        if (!selection) return null;
        if (modelId.startsWith('image:')) {
          return resolveImageSelection(
            modelId.slice('image:'.length),
            selection,
            loadImageModels,
          ).then(model => (model ? { ...model, id: modelId } : null));
        }
        return resolveRepositorySelection(modelId, selection, signal);
      },
    },
    randomBytes: length => {
      const bytes = new Uint8Array(length);
      crypto.getRandomValues(bytes);
      return bytes;
    },
  };
}
