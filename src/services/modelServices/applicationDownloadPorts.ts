import RNFS from 'react-native-fs';
import { unzip } from 'react-native-zip-archive';
import type { ModelsDownloadPorts } from '@offgrid/application';
import type {
  DownloadFinalizationTransaction,
  DownloadFinalizePort,
  PersistedModelDownload,
} from '@offgrid/models';
import {
  imageDownloadDescriptorFromMetadata,
  installedImageModel,
  modelProjectorLocalName,
} from '@offgrid/models';
import { APP_CONFIG } from '../../constants';
import type { DownloadedModel, ONNXImageModel } from '../../types';
import { useAppStore } from '../../stores/appStore';
import { ModelDownloadFileAdapter } from '../adapters/downloads/modelDownloadFileAdapter';
import {
  buildDownloadedModel,
  loadDownloadedModels,
  persistDownloadedModel,
  loadDownloadedImageModels,
  saveImageModelsList,
  saveModelsList,
} from '../adapters/models/library/modelRegistryStorageAdapter';
import { modelDownloadPersistenceAdapter } from '../adapters/downloads/modelDownloadPersistenceAdapter';
import { nativeDownloadTransferAdapter } from '../adapters/downloads/nativeDownloadTransferAdapter';
import { createMobileDownloadedModelRegistryAdapter } from '../adapters/downloads/downloadedModelRegistryAdapter';
import {
  mobileImageDownloadMetadata,
  mobileTextDownloadMetadata,
} from './modelDownloadRequests';
import { textDownloadFinalizationMetadata } from './textDownloadFinalizationMetadata';
import {
  DownloadInstallTransaction,
  installRecoveryMoves,
  parseInstallRecoveryState,
} from './downloadInstallTransaction';
import { huggingFaceService } from '../huggingface';
import {
  ensureImageExtractionComplete,
  validateImageModelDir,
} from '../../utils/imageModelIntegrity';
import {
  downloadCoreMLTokenizerFiles,
  resolveCoreMLModelDir,
} from '../../utils/coreMLModelUtils';
import { mobileProjectorRepairPlatformPort } from './projectorRepairPlatformPort';
import {
  compositeDownloadFilePort,
  compositeDownloadTransferPort,
  type MobileManagedArtifactIO,
} from './modelDownloadArtifactIO';

const documentFiles = new ModelDownloadFileAdapter(RNFS.DocumentDirectoryPath);

const cancelled = (): Error => new Error('Download cancelled');

function transcriptionInstallName(artifactName: string): string {
  return `${APP_CONFIG.whisperStorageDir}/${artifactName}`;
}

async function beginTranscriptionFinalization(
  record: Readonly<PersistedModelDownload>,
): Promise<DownloadFinalizationTransaction> {
  const directory = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.whisperStorageDir}`;
  const installs = record.manifest.artifacts.map(artifact => {
    const localName = transcriptionInstallName(artifact.name);
    return {
      artifactId: artifact.id,
      localName,
      source: documentFiles.pathFor(artifact.localName),
      destination: documentFiles.pathFor(localName),
    };
  });
  const transaction = new DownloadInstallTransaction({
    version: 1,
    moves: await installRecoveryMoves(installs),
  });
  return {
    recoveryState: transaction.recoveryState,
    async prepare(signal) {
      const installed: Array<{ artifactId: string; localName: string }> = [];
      if (signal.aborted) throw cancelled();
      if (!(await RNFS.exists(directory))) await RNFS.mkdir(directory);
      for (const [index, artifact] of installs.entries()) {
        if (signal.aborted) throw cancelled();
        await transaction.move(index);
        installed.push({
          artifactId: artifact.artifactId,
          localName: artifact.localName,
        });
      }
      if (signal.aborted) throw cancelled();
      return { artifacts: installed };
    },
    commit: () => transaction.commit(),
    rollback: () => transaction.rollback(),
  };
}

function publicMetadata(
  record: Readonly<PersistedModelDownload>,
): string | undefined {
  const value = record.manifest.metadata?.publicMetadataJson;
  return typeof value === 'string' ? value : undefined;
}

async function beginTextFinalization(
  record: Readonly<PersistedModelDownload>,
): Promise<DownloadFinalizationTransaction> {
  const primary = record.manifest.artifacts.find(
    artifact => artifact.role === 'primary',
  );
  const metadata = textDownloadFinalizationMetadata(record);
  if (!metadata) throw new Error('Text download metadata is missing.');
  const modelsDirectory = `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`;
  if (!primary) throw new Error('Text download has no primary artifact.');
  const previousModels = await loadDownloadedModels(modelsDirectory);
  const restoreTextRegistry = async (
    models: readonly (typeof previousModels)[number][],
  ) => {
    await saveModelsList([...models]);
    useAppStore.getState().setDownloadedModels([...models]);
  };
  const installs = record.manifest.artifacts.map(artifact => {
    const finalName =
      artifact.role === 'mmproj'
        ? modelProjectorLocalName(metadata.file.name, artifact.name)
        : artifact.name;
    const localName = `${APP_CONFIG.modelStorageDir}/${finalName}`;
    return {
      artifactId: artifact.id,
      role: artifact.role,
      localName,
      source: documentFiles.pathFor(artifact.localName),
      destination: documentFiles.pathFor(localName),
    };
  });
  const transaction = new DownloadInstallTransaction(
    {
      version: 1,
      moves: await installRecoveryMoves(installs),
      priorTextModels: previousModels,
    },
    restoreTextRegistry,
  );
  return {
    recoveryState: transaction.recoveryState,
    async prepare(signal) {
      if (!(await RNFS.exists(modelsDirectory)))
        await RNFS.mkdir(modelsDirectory);
      const installed: Array<{ artifactId: string; localName: string }> = [];
      let projectorPath: string | undefined;
      for (const [index, artifact] of installs.entries()) {
        if (signal.aborted) throw cancelled();
        await transaction.move(index);
        if (artifact.role === 'mmproj') projectorPath = artifact.destination;
        installed.push({
          artifactId: artifact.artifactId,
          localName: artifact.localName,
        });
      }
      if (signal.aborted) throw cancelled();
      const model = await buildDownloadedModel({
        modelId: metadata.repositoryId,
        file: metadata.file,
        resolvedLocalPath: documentFiles.pathFor(
          `${APP_CONFIG.modelStorageDir}/${primary.name}`,
        ),
        mmProjPath: projectorPath,
      });
      await persistDownloadedModel(model, modelsDirectory);
      if (signal.aborted) throw cancelled();
      useAppStore
        .getState()
        .setDownloadedModels([
          ...previousModels.filter(item => item.id !== model.id),
          model,
        ]);
      return { artifacts: installed };
    },
    commit: () => transaction.commit(),
    rollback: () => transaction.rollback(),
  };
}

function safeImageRelativePath(value: string): string {
  const parts = value.split('/');
  if (
    !parts.length ||
    parts.some(
      part => !part || part === '.' || part === '..' || part.includes('\\'),
    )
  ) {
    throw new Error(`Image artifact path is invalid: ${value}`);
  }
  return parts.join('/');
}

async function ensureParent(path: string): Promise<void> {
  const parent = path.slice(0, path.lastIndexOf('/'));
  if (parent && !(await RNFS.exists(parent))) await RNFS.mkdir(parent);
}

async function restoreImageRegistry(
  models: readonly ONNXImageModel[],
): Promise<void> {
  await saveImageModelsList([...models]);
  useAppStore.getState().setDownloadedImageModels([...models]);
}

async function beginImageFinalization(
  record: Readonly<PersistedModelDownload>,
): Promise<DownloadFinalizationTransaction> {
  const metadata = mobileImageDownloadMetadata(publicMetadata(record));
  if (!metadata) throw new Error('Image download metadata is invalid.');
  const descriptor = imageDownloadDescriptorFromMetadata(
    record.manifest.modelId,
    metadata,
  );
  const root = `${RNFS.DocumentDirectoryPath}/image_models`;
  const destination = `${root}/${descriptor.id}`;
  const prepared = `${
    RNFS.DocumentDirectoryPath
  }/offgrid-download-staging/${encodeURIComponent(
    record.manifest.id,
  )}/prepared-image`;
  const previous = await loadDownloadedImageModels(root);
  const moves = await installRecoveryMoves([{ source: prepared, destination }]);
  const transaction = new DownloadInstallTransaction(
    {
      version: 1,
      moves: [{ ...moves[0], discardSourceOnRollback: true }],
      priorImageModels: previous,
    },
    undefined,
    restoreImageRegistry,
  );
  return {
    recoveryState: transaction.recoveryState,
    async prepare(signal) {
      if (signal.aborted) throw cancelled();
      if (await RNFS.exists(prepared)) await RNFS.unlink(prepared);
      await RNFS.mkdir(prepared);
      if (metadata.imageDownloadType === 'zip') {
        const archive = record.manifest.artifacts[0];
        if (!archive) throw new Error('Image archive is missing.');
        await unzip(documentFiles.pathFor(archive.localName), prepared);
        await ensureImageExtractionComplete({
          backend: descriptor.backend,
          modelDir: prepared,
          zipPath: documentFiles.pathFor(archive.localName),
          modelId: descriptor.id,
        });
      } else {
        for (const artifact of record.manifest.artifacts) {
          if (signal.aborted) throw cancelled();
          const relative = safeImageRelativePath(artifact.name);
          const target = `${prepared}/${relative}`;
          await ensureParent(target);
          await RNFS.copyFile(
            documentFiles.pathFor(artifact.localName),
            target,
          );
        }
        await RNFS.writeFile(`${prepared}/_ready`, '', 'utf8');
      }
      if (descriptor.backend === 'mnn' || descriptor.backend === 'qnn') {
        const integrity = await validateImageModelDir(
          prepared,
          descriptor.backend,
        );
        if (!integrity.complete)
          throw new Error(
            `Image model is incomplete: ${integrity.missing.join(', ')}`,
          );
      }
      if (descriptor.backend === 'coreml' && descriptor.repo) {
        await downloadCoreMLTokenizerFiles(prepared, descriptor.repo);
      }
      if (signal.aborted) throw cancelled();
      await transaction.move(0);
      const resolvedModelPath =
        descriptor.backend === 'coreml'
          ? await resolveCoreMLModelDir(destination)
          : destination;
      const installed = installedImageModel({
        model: descriptor,
        resolvedModelPath,
        downloadedAt: new Date().toISOString(),
      }) as ONNXImageModel;
      await saveImageModelsList([
        ...previous.filter(model => model.id !== installed.id),
        installed,
      ]);
      if (signal.aborted) throw cancelled();
      useAppStore
        .getState()
        .setDownloadedImageModels([
          ...previous.filter(model => model.id !== installed.id),
          installed,
        ]);
      return {
        artifacts: record.manifest.artifacts.map(artifact => ({
          artifactId: artifact.id,
          localName:
            metadata.imageDownloadType === 'zip'
              ? `image_models/${descriptor.id}`
              : `image_models/${descriptor.id}/${safeImageRelativePath(
                  artifact.name,
                )}`,
        })),
      };
    },
    commit: () => transaction.commit(),
    rollback: () => transaction.rollback(),
  };
}

function createFinalizer(
  managed?: MobileManagedArtifactIO,
): DownloadFinalizePort {
  return {
    async recover(input) {
      if (input.download.manifest.kind === 'voice') {
        if (!managed)
          throw new Error('This build does not support voice model downloads.');
        await managed.recoverFinalization(input);
        return;
      }
      const restoreTextRegistry = async (
        models: readonly DownloadedModel[],
      ) => {
        await saveModelsList([...models]);
        useAppStore.getState().setDownloadedModels([...models]);
      };
      const transaction = new DownloadInstallTransaction(
        parseInstallRecoveryState(input.state),
        restoreTextRegistry,
        restoreImageRegistry,
      );
      if (input.disposition === 'commit') await transaction.commit();
      else await transaction.rollback();
    },
    async begin(record) {
      if (record.manifest.kind === 'voice') {
        if (!managed)
          throw new Error('This build does not support voice model downloads.');
        return managed.beginFinalization(record);
      }
      if (record.manifest.kind === 'transcription') {
        return beginTranscriptionFinalization(record);
      }
      if (record.manifest.kind === 'text') {
        return beginTextFinalization(record);
      }
      if (record.manifest.kind === 'image') {
        return beginImageFinalization(record);
      }
      throw new Error(
        `Mobile download finalizer does not support ${record.manifest.kind} yet.`,
      );
    },
  };
}

/** Raw Mobile I/O only. The Models facade owns queueing, recovery, policy, and projection. */
export function createMobileApplicationDownloadPorts(
  managed?: MobileManagedArtifactIO,
): ModelsDownloadPorts {
  const files = compositeDownloadFilePort(documentFiles, managed);
  const transfers = compositeDownloadTransferPort(
    nativeDownloadTransferAdapter,
    managed,
  );
  return {
    ports: {
      persistence: modelDownloadPersistenceAdapter,
      files,
      transfers,
      finalizer: createFinalizer(managed),
      concurrency: 3,
    },
    sources: {
      resolve: async request => {
        const text =
          request.modelType === 'text'
            ? mobileTextDownloadMetadata(request.metadataJson)
            : null;
        if (text) {
          return {
            displayName:
              request.installation?.displayName ??
              text.repositoryId.split('/').at(-1) ??
              text.repositoryId,
            catalogEntry: request.installation?.catalogEntry ?? true,
            artifacts: [
              {
                fileName: text.file.name,
                url:
                  text.file.downloadUrl ||
                  huggingFaceService.getDownloadUrl(
                    text.repositoryId,
                    text.file.name,
                  ),
                totalBytes: text.file.size,
                sha256: text.file.sha256,
                role: 'primary' as const,
              },
              ...(text.file.mmProjFile
                ? [
                    {
                      fileName: text.file.mmProjFile.name,
                      url:
                        text.file.mmProjFile.downloadUrl ||
                        huggingFaceService.getDownloadUrl(
                          text.repositoryId,
                          text.file.mmProjFile.name,
                        ),
                      totalBytes: text.file.mmProjFile.size,
                      sha256: text.file.mmProjFile.sha256,
                      role: 'mmproj' as const,
                    },
                  ]
                : []),
            ],
          };
        }
        if (request.modelType === 'image') {
          const metadata = mobileImageDownloadMetadata(request.metadataJson);
          if (!metadata) throw new Error('Image download metadata is invalid.');
          const descriptor = imageDownloadDescriptorFromMetadata(
            request.modelId,
            metadata,
          );
          const sourceFiles =
            metadata.imageModelHuggingFaceFiles ??
            metadata.imageModelCoremlFiles;
          return {
            displayName: metadata.imageModelName,
            catalogEntry: request.installation?.catalogEntry ?? true,
            artifacts:
              metadata.imageDownloadType === 'zip'
                ? [
                    {
                      fileName: request.fileName,
                      url: metadata.imageModelDownloadUrl ?? request.url,
                      totalBytes: metadata.imageModelSize,
                      role: 'primary' as const,
                    },
                  ]
                : (sourceFiles ?? []).map((artifact, index) => ({
                    fileName: artifact.relativePath ?? artifact.path,
                    url:
                      artifact.downloadUrl ??
                      (descriptor.huggingFaceRepo
                        ? `https://huggingface.co/${descriptor.huggingFaceRepo}/resolve/main/${artifact.path}`
                        : ''),
                    totalBytes: artifact.size,
                    role: index === 0 ? ('primary' as const) : ('aux' as const),
                  })),
          };
        }
        if (request.modelType === 'tts') {
          if (!managed) {
            return {
              availability: 'coming_soon',
              unavailableReason: 'Voice model downloads require Off Grid Pro.',
            };
          }
          return {
            displayName: 'Kokoro Text-to-Speech',
            catalogEntry: true,
            artifacts: [
              {
                fileName: request.fileName,
                url: '',
                totalBytes: request.totalBytes,
                role: 'primary' as const,
              },
            ],
          };
        }
        return {};
      },
    },
    downloadedRegistry: createMobileDownloadedModelRegistryAdapter(managed),
    projectorRepair: mobileProjectorRepairPlatformPort,
    imageOnboardingComplete: () =>
      useAppStore.getState().onboardingChecklist.triedImageGen,
  };
}
