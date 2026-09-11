import RNFS from 'react-native-fs';
import logger from '../../../utils/logger';
import { resolveStoredModelPath } from '@offgrid/models';

/**
 * ONE answer to "is this stored model still on disk, and where?".
 *
 * Text models and image models had a loader each, asking the same three questions in the same order
 * with the same subtle rule about unverifiable probes — and drifting, because two copies always do.
 * The image copy was still using a raw existence check long after the text copy was hardened, so the
 * data-loss guard below protected exactly half the registry. That is the drift this module exists to
 * make impossible: the rule is written once and both registries call it.
 */

/** The last path segment. The only place this arithmetic is written. */
/**
 * Rebase a path recorded under a previous container onto the current base directory.
 *
 * iOS stores app data under /var/mobile/Containers/Data/Application/<UUID>/, and that UUID changes
 * on every reinstall — so a path saved yesterday names nothing today even though the file is right
 * where it was left. Returns null when the stored path has no segment in common to rebase from.
 */
/**
 * Existence probe that NEVER conflates a transient filesystem error with "file absent".
 *
 * `RNFS.exists` can reject on a transient FS hiccup (I/O error, container not yet mounted,
 * momentary permission blip). If we read that rejection as "the file is gone", the caller
 * prunes the model from the registry and persists the pruned list — silently unlinking a
 * valid, fully-downloaded multi-GB model (G1 data loss). `verifiable: false` marks "we
 * could not tell", which callers MUST treat as keep-the-model, not drop-it.
 */
async function probeExists(path: string): Promise<{ exists: boolean; verifiable: boolean }> {
  try {
    return { exists: await RNFS.exists(path), verifiable: true };
  } catch (e) {
    logger.warn(
      `[ModelManagerStorage] existence check could not be verified for ${path} — keeping model (transient)`,
      e,
    );
    return { exists: false, verifiable: false };
  }
}

/** Per-model verdict. `keep` is the decision; `exists` is the evidence a caller may need. */
export interface PathVerdict {
  exists: boolean;
  verifiable: boolean;
  keep: boolean;
}

export interface StoredPathAccessor<T> {
  getPath: (model: T) => string;
  setPath: (model: T, path: string) => void;
}

/**
 * Probe every model's primary path, rebasing the ones that moved, and decide which survive.
 *
 * Mutates `setPath` in place for a model whose file was found at a rebased location — the caller
 * persists that repair via `pathsUpdated`. A model is dropped only when EVERY probe cleanly resolved
 * "absent"; "we could not tell" keeps it.
 */
export async function reconcilePrimaryPaths<T>(
  models: T[],
  baseDir: string,
  { getPath, setPath }: StoredPathAccessor<T>,
): Promise<{ verdicts: PathVerdict[]; pathsUpdated: boolean }> {
  const direct = await Promise.all(models.map(m => probeExists(getPath(m))));

  const rebased = await Promise.all(
    models.map(async (model, i) => {
      if (direct[i].exists) return null;
      const resolved = resolveStoredModelPath(getPath(model), baseDir);
      if (!resolved || resolved === getPath(model)) return null;
      const { exists, verifiable } = await probeExists(resolved);
      if (exists) setPath(model, resolved);
      return { exists, verifiable, updated: exists };
    }),
  );

  let pathsUpdated = false;
  const verdicts = models.map((_, i) => {
    const move = rebased[i];
    if (move?.updated) pathsUpdated = true;
    const exists = direct[i].exists || Boolean(move?.exists);
    const verifiable = direct[i].verifiable && (move ? move.verifiable : true);
    // Keep the model if it exists OR if we couldn't verify its absence. Pruning (and the persist
    // that follows it) is reserved for files PROVABLY gone.
    return { exists, verifiable, keep: exists || !verifiable };
  });

  return { verdicts, pathsUpdated };
}
