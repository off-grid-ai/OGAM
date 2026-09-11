import RNFS from 'react-native-fs';
import type { DownloadedModel, ONNXImageModel } from '../../types';
import { APP_CONFIG } from '../../constants';

export interface InstallRecoveryMove {
  readonly source: string;
  readonly destination: string;
  readonly backup: string | null;
  readonly discardSourceOnRollback?: boolean;
}

export interface InstallRecoveryState {
  readonly version: 1;
  readonly moves: readonly InstallRecoveryMove[];
  readonly priorTextModels?: readonly DownloadedModel[];
  readonly priorImageModels?: readonly ONNXImageModel[];
}

const MAX_RECOVERY_BYTES = 2_000_000;
const MAX_MOVES = 512;
const MAX_MODELS = 512;

function shortString(value: unknown, max = 2_048): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !value.includes('\0');
}

function safeDevicePath(value: unknown, roots: readonly string[]): value is string {
  if (!shortString(value)) return false;
  if (value.includes('\\') || !roots.some(root => value.startsWith(`${root}/`))) return false;
  return value.split('/').every(segment => segment !== '.' && segment !== '..');
}

function validMove(value: unknown, index: number): value is InstallRecoveryMove {
  if (!value || typeof value !== 'object') return false;
  const move = value as Partial<InstallRecoveryMove>;
  const documentRoot = RNFS.DocumentDirectoryPath;
  const sourceRoots = [`${documentRoot}/offgrid-download-staging`];
  const destinationRoots = [
    `${documentRoot}/${APP_CONFIG.modelStorageDir}`,
    `${documentRoot}/${APP_CONFIG.whisperStorageDir}`,
    `${documentRoot}/image_models`,
  ];
  return safeDevicePath(move.source, sourceRoots)
    && safeDevicePath(move.destination, destinationRoots)
    && move.source !== move.destination
    && optional(move.discardSourceOnRollback, 'boolean')
    && (move.backup === null || (
      safeDevicePath(move.backup, destinationRoots)
      && move.backup === `${move.destination}.offgrid-replacement-${index}`
    ));
}

function optional(value: unknown, kind: 'string' | 'number' | 'boolean'): boolean {
  return value === undefined || typeof value === kind;
}

function optionalNonNegativeNumber(value: unknown): boolean {
  return value === undefined || (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
  );
}

function validCredibility(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (item.source === 'lmstudio' || item.source === 'official'
      || item.source === 'verified-quantizer' || item.source === 'community')
    && typeof item.isOfficial === 'boolean'
    && typeof item.isVerifiedQuantizer === 'boolean' && optional(item.verifiedBy, 'string');
}

function validOrigin(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return shortString(item.repoId) && shortString(item.revision) && shortString(item.path);
}

function validDownloadedModelBase(model: Record<string, unknown>): boolean {
  return shortString(model.id) && shortString(model.name) && shortString(model.author)
    && safeDevicePath(model.filePath, [
      `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`,
    ])
    && shortString(model.fileName) && !String(model.fileName).includes('/')
    && !String(model.fileName).includes('\\')
    && typeof model.fileSize === 'number' && Number.isFinite(model.fileSize) && model.fileSize >= 0
    && shortString(model.quantization) && shortString(model.downloadedAt)
    && validCredibility(model.credibility) && validOrigin(model.origin);
}

function validEngineFields(model: Record<string, unknown>): boolean {
  if (model.engine === 'llama') {
    return optional(model.isVisionModel, 'boolean')
      && (model.mmProjPath === undefined || safeDevicePath(model.mmProjPath, [
        `${RNFS.DocumentDirectoryPath}/${APP_CONFIG.modelStorageDir}`,
      ]))
      && optional(model.mmProjFileName, 'string') && optionalNonNegativeNumber(model.mmProjFileSize);
  }
  if (model.engine === 'litert') {
    return typeof model.liteRTVision === 'boolean' && optional(model.liteRTAudio, 'boolean');
  }
  return false;
}

function validDownloadedModel(value: unknown): value is DownloadedModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  return validDownloadedModelBase(model) && validEngineFields(model);
}

function validImageModel(value: unknown): value is ONNXImageModel {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const model = value as Record<string, unknown>;
  return shortString(model.id) && shortString(model.name) && typeof model.description === 'string'
    && safeDevicePath(model.modelPath, [`${RNFS.DocumentDirectoryPath}/image_models`])
    && shortString(model.downloadedAt)
    && optionalNonNegativeNumber(model.size) && model.size !== undefined
    && optional(model.style, 'string')
    && (model.backend === undefined || model.backend === 'mnn'
      || model.backend === 'qnn' || model.backend === 'coreml')
    && (model.attentionVariant === undefined || model.attentionVariant === 'split_einsum'
      || model.attentionVariant === 'original');
}

export function parseInstallRecoveryState(value: string): InstallRecoveryState {
  if (value.length > MAX_RECOVERY_BYTES) throw new Error('The model install recovery state is too large.');
  const parsed = JSON.parse(value) as Partial<InstallRecoveryState>;
  if (parsed.version !== 1 || !Array.isArray(parsed.moves) || parsed.moves.length > MAX_MOVES
    || !parsed.moves.every(validMove)) {
    throw new Error('The model install recovery state has invalid file moves.');
  }
  const paths = parsed.moves.flatMap(move => [move.source, move.destination, move.backup]
    .filter((path): path is string => path !== null));
  if (new Set(paths).size !== paths.length) {
    throw new Error('The model install recovery state has colliding file paths.');
  }
  if (parsed.priorTextModels !== undefined && (
    !Array.isArray(parsed.priorTextModels)
    || parsed.priorTextModels.length > MAX_MODELS
    || !parsed.priorTextModels.every(validDownloadedModel)
  )) throw new Error('The model install recovery state has invalid model records.');
  const modelIds = parsed.priorTextModels?.map(model => model.id) ?? [];
  if (new Set(modelIds).size !== modelIds.length) {
    throw new Error('The model install recovery state has duplicate model records.');
  }
  if (parsed.priorImageModels !== undefined && (
    !Array.isArray(parsed.priorImageModels)
    || parsed.priorImageModels.length > MAX_MODELS
    || !parsed.priorImageModels.every(validImageModel)
  )) throw new Error('The model install recovery state has invalid image records.');
  const imageIds = parsed.priorImageModels?.map(model => model.id) ?? [];
  if (new Set(imageIds).size !== imageIds.length) {
    throw new Error('The model install recovery state has duplicate image records.');
  }
  return parsed as InstallRecoveryState;
}

/** Execute the file plan Shared durably journals before any platform mutation starts. */
export class DownloadInstallTransaction {
  readonly recoveryState: string;

  constructor(
    private readonly state: InstallRecoveryState,
    private readonly restoreTextRegistry?: (models: readonly DownloadedModel[]) => Promise<void>,
    private readonly restoreImageRegistry?: (models: readonly ONNXImageModel[]) => Promise<void>,
  ) {
    this.recoveryState = JSON.stringify(state);
    parseInstallRecoveryState(this.recoveryState);
  }

  async move(index: number): Promise<void> {
    const move = this.state.moves[index];
    if (!move) throw new Error(`Install move does not exist: ${index}`);
    if (move.backup && await RNFS.exists(move.destination) && !(await RNFS.exists(move.backup))) {
      await RNFS.moveFile(move.destination, move.backup);
    }
    if (await RNFS.exists(move.source)) {
      if (await RNFS.exists(move.destination)) {
        throw new Error(`Install destination is not protected: ${move.destination}`);
      }
      await RNFS.moveFile(move.source, move.destination);
      return;
    }
    if (!(await RNFS.exists(move.destination))) {
      throw new Error(`Install artifact is missing: ${move.source}`);
    }
  }

  async commit(): Promise<void> {
    for (const move of this.state.moves) {
      if (move.backup && await RNFS.exists(move.backup)) await RNFS.unlink(move.backup);
    }
  }

  async rollback(): Promise<void> {
    const failures: unknown[] = [];
    if (this.state.priorTextModels && this.restoreTextRegistry) {
      try {
        await this.restoreTextRegistry(this.state.priorTextModels);
      } catch (error) {
        failures.push(error);
      }
    }
    if (this.state.priorImageModels && this.restoreImageRegistry) {
      try {
        await this.restoreImageRegistry(this.state.priorImageModels);
      } catch (error) {
        failures.push(error);
      }
    }
    for (const move of [...this.state.moves].reverse()) {
      try {
        const backupExists = move.backup !== null && await RNFS.exists(move.backup);
        // A planned backup that does not exist means promotion never started. In that state the
        // destination is still the last good install and must not be mistaken for the new file.
        if ((move.backup === null || backupExists)
          && !(await RNFS.exists(move.source))
          && await RNFS.exists(move.destination)) {
          await RNFS.moveFile(move.destination, move.source);
        }
        if (move.discardSourceOnRollback && await RNFS.exists(move.source)) {
          await RNFS.unlink(move.source);
        }
        if (move.backup && backupExists) {
          if (await RNFS.exists(move.destination)) await RNFS.unlink(move.destination);
          await RNFS.moveFile(move.backup, move.destination);
        }
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Model install rollback failed.');
  }
}

export async function installRecoveryMoves(
  pairs: readonly { source: string; destination: string }[],
): Promise<InstallRecoveryMove[]> {
  return Promise.all(pairs.map(async (pair, index) => ({
    ...pair,
    backup: await RNFS.exists(pair.destination)
      ? `${pair.destination}.offgrid-replacement-${index}`
      : null,
  })));
}
