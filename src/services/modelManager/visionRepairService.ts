import RNFS from 'react-native-fs';
import { statFile } from '../../utils/fileStat';
import logger from '../../utils/logger';
import { DownloadedModel, ModelFile } from '../../types';
import { commitModelsList } from './storage';
import { isMMProjFile } from './scan';
import { canKeepMmProjLink, pickMmProjForModel } from '../mmproj';
import { performMmProjRepairDownload } from './download';
import { resolveVisionRepairSource } from './visionRepairSource';
import { huggingFaceService } from '../huggingface';
import type { DownloadProgressCallback } from './types';

/**
 * The projector (mmproj) lifecycle: linking one that is already on disk, fetching a missing one,
 * and recording the result on the model.
 *
 * It lives beside the model registry rather than inside it because "can this model see?" is one
 * question with one answer, asked from three surfaces (Download Manager, Models, Chat). The manager
 * keeps the methods and passes itself in, so a caller still has one object to talk to.
 */

/**
 * What repairVision did, in the vocabulary a screen needs to explain it. Every outcome is
 * something the user can act on - "unknown" tells them the copy has no upstream, which is the
 * truthful end of the line for a local import rather than an error to dress up.
 */
export type VisionRepairOutcome =
  | { kind: 'repaired'; repoId: string }
  | { kind: 'linked' }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'noProjectorPublished'; repoId: string }
  | { kind: 'unknown' }
  | { kind: 'unsupported' };

export interface RepairOpts {
  onProgress?: DownloadProgressCallback;
  onDownloadIdReady?: (id: string) => void;
  modelKey?: string;
}

/**
 * What this module needs from the model registry. The re-entrant members are passed rather than
 * imported so every call still goes through the manager's own method - one owner of the registry,
 * and one place a caller can observe.
 */
export interface VisionRepairContext {
  modelsDir: string;
  initialize(): Promise<void>;
  getDownloadedModels(): Promise<DownloadedModel[]>;
  saveModelWithMmproj(modelId: string, mmProjPath: string): Promise<void>;
  linkOrphanMmProj(): Promise<void>;
  repairMmProj(target: MmProjTarget, opts?: RepairOpts): Promise<void>;
}

export async function linkOrphanMmProj(
  ctx: VisionRepairContext,
): Promise<void> {
  const models = await ctx.getDownloadedModels();
  let dirFiles: RNFS.ReadDirResItemT[] = [];
  try {
    dirFiles = await RNFS.readDir(ctx.modelsDir);
  } catch {
    return;
  }
  const mmProjFiles = dirFiles.filter(f => f.isFile() && isMMProjFile(f.name));
  if (mmProjFiles.length === 0) return;

  const toSave: DownloadedModel[] = [];
  for (const m of models) {
    if (m.engine !== 'llama') continue;
    // Strict match (shared rule): the projector must belong to THIS model by name+variant. This is the
    // SAME rule the loader uses, so link-time and load-time can no longer disagree (the E2B↔E4B split).
    const chosenName = pickMmProjForModel(
      m.fileName,
      mmProjFiles.map(f => f.name),
    );
    const match = chosenName
      ? mmProjFiles.find(f => f.name === chosenName)
      : undefined;

    if (m.mmProjPath) {
      // Clear the link if the stored file no longer exists or cannot be paired with this model.
      const persistedName = m.mmProjPath.split('/').pop() ?? '';
      const belongs = canKeepMmProjLink(m.fileName, persistedName);
      const fileExists = await RNFS.exists(m.mmProjPath).catch(() => false);
      if (!fileExists || !belongs) {
        logger.log(
          `[linkOrphanMmProj] ${m.id} — clearing bad link: ${m.mmProjPath}`,
        );
        // Clear only the dead/wrong on-disk pointer — KEEP isVisionModel + mmProjFileName so the model is
        // still recognized as a vision model that NEEDS REPAIR (needsVisionRepair → true → the wrench and
        // the "download the vision file" prompt appear). Wiping the vision flag made it look like a plain
        // text model, hiding the repair path entirely (device 2026-07-14).
        toSave.push({
          ...m,
          mmProjPath: undefined,
          mmProjFileSize: undefined,
          isVisionModel: true,
        });
      }
      // If link is valid, leave it alone
    } else if (match) {
      logger.log(`[linkOrphanMmProj] ${m.id} — linking ${match.path}`);
      await ctx.saveModelWithMmproj(m.id, match.path);
    }
  }

  if (toSave.length > 0) {
    const current = await ctx.getDownloadedModels();
    await commitModelsList(
      current.map(m => toSave.find(s => s.id === m.id) ?? m),
    );
  }
}

/**
 * The ONE way any surface repairs a vision model - Download Manager, Models screen and Chat all
 * call this. Each of them used to rebuild a Hugging Face repo id by splitting the model's DISPLAY
 * id at its last slash, which is three copies of one rule and wrong for every model that did not
 * come from a repo of that exact name. A transferred or imported model produced a repo id HF has
 * never seen, and HF answers an unknown repo with 401 - so the user was shown an auth error for a
 * file that never had an upstream.
 *
 * Resolution order, most certain first: recorded provenance, then a projector already sitting on
 * disk, then a size-verified HF match. Anything else is reported, never guessed at.
 */
export async function repairVision(
  ctx: VisionRepairContext,
  model: DownloadedModel,
  opts?: RepairOpts,
): Promise<VisionRepairOutcome> {
  if (model.engine !== 'llama') return { kind: 'unsupported' };

  // A projector already next to the weights needs no network and no identification at all.
  await ctx.linkOrphanMmProj();
  const relinked = (await ctx.getDownloadedModels()).find(
    m => m.id === model.id,
  );
  if (relinked?.engine === 'llama' && relinked.mmProjPath)
    return { kind: 'linked' };

  const source = await resolveVisionRepairSource(
    {
      origin: model.origin,
      fileName: model.fileName,
      fileSize: model.fileSize,
    },
    fileName => huggingFaceService.findReposPublishing(fileName),
  );
  if (source.kind === 'ambiguous')
    return { kind: 'ambiguous', candidates: source.candidates };
  if (source.kind === 'unknown') return { kind: 'unknown' };

  const files = await huggingFaceService.getModelFiles(
    source.origin.repoId,
    source.origin.revision,
  );
  const file = files.find(f => f.name === model.fileName);
  if (!file?.mmProjFile)
    return { kind: 'noProjectorPublished', repoId: source.origin.repoId };

  await ctx.repairMmProj({ modelId: source.origin.repoId, file }, { ...opts, modelKey: model.id });
  return { kind: 'repaired', repoId: source.origin.repoId };
}

/** The repo and the weights file the projector belongs to - they are never meaningful apart. */
export interface MmProjTarget {
  modelId: string;
  file: ModelFile;
}

export async function repairMmProj(
  ctx: VisionRepairContext,
  { modelId, file }: MmProjTarget,
  opts?: RepairOpts,
): Promise<void> {
  if (!file.mmProjFile) throw new Error('Model file has no associated mmproj');
  await ctx.initialize();
  // download.ts owns background-download orchestration: it starts the sidecar,
  // drives the SAME download-store rows the normal download writes (so the existing
  // determinate progress bar lights up during the ~900MB fetch — BUG OD2), moves the
  // file, and tears the transient row down. We just persist the resolved path.
  const resolvedPath = await performMmProjRepairDownload({
    modelId,
    file,
    modelsDir: ctx.modelsDir,
    ...opts,
  });
  await ctx.saveModelWithMmproj(opts?.modelKey ?? `${modelId}/${file.name}`, resolvedPath);
}

/**
 * Heal the DURABLE vision flag on a record from the authoritative catalog (the repo ships an mmproj).
 * The old link cleanup wiped isVisionModel on some records, so the Download Manager — which has no catalog —
 * showed them as plain text. Persisting the truth here makes the record the SINGLE source both surfaces
 * read. No-op if already set (so it's safe to call on render/focus). Returns true if it changed anything.
 */
export async function markVisionModel(
  ctx: VisionRepairContext,
  modelId: string,
): Promise<boolean> {
  const models = await ctx.getDownloadedModels();
  const target = models.find(m => m.id === modelId);
  if (target?.engine !== 'llama' || target.isVisionModel) return false;
  await commitModelsList(
    models.map(m => (m.id === modelId ? { ...m, isVisionModel: true } : m)),
  );
  return true;
}

export async function saveModelWithMmproj(
  ctx: VisionRepairContext,
  modelId: string,
  mmProjPath: string,
): Promise<void> {
  const mmProjFileName = mmProjPath.split('/').pop() || mmProjPath;
  const mmProjFileSize = (await statFile(mmProjPath))?.size ?? 0;

  const models = await ctx.getDownloadedModels();
  await commitModelsList(
    models.map(m =>
      m.id === modelId
        ? {
            ...m,
            mmProjPath,
            mmProjFileName,
            mmProjFileSize,
            isVisionModel: true,
          }
        : m,
    ),
  );
}

export async function clearMmProjLink(
  ctx: VisionRepairContext,
  modelId: string,
): Promise<void> {
  const models = await ctx.getDownloadedModels();
  // Clearing a link must preserve the model's vision identity. Keep the filename
  // so repair can relink the existing file or download its replacement.
  await commitModelsList(
    models.map(m =>
      m.id === modelId
        ? {
            ...m,
            mmProjPath: undefined,
            mmProjFileSize: undefined,
            isVisionModel: true,
          }
        : m,
    ),
  );
}
