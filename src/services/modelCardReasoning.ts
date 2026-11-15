/**
 * Reads a downloaded model's Hugging Face model card once and records whether the model reasons.
 *
 * The chat template alone can claim a thinking switch the model never uses (LFM3-Omni-2B: "This is
 * a non-reasoning model"). The shared rule reads the card; this is the mobile port that fetches it
 * and keeps the answer on the model's record, so the Thinking toggle stays right offline and after
 * a restart. Offline or a missing card leaves the record unknown and the template decides.
 */
import { modelCardDeniesReasoning, modelCardUrl } from '@offgrid/models';
import { useAppStore } from '../stores/appStore';
import { commitModelsList } from './modelManager/storage';
import type { DownloadedModel } from '../types';
import logger from '../utils/logger';

/** The Hugging Face repo a model came from: its recorded origin, else the repo its id names. */
function repoOf(model: DownloadedModel): { repoId: string; revision?: string } | null {
  if (model.origin?.repoId) return { repoId: model.origin.repoId, revision: model.origin.revision };
  const [owner, repo] = model.id.split('/');
  return owner && repo ? { repoId: `${owner}/${repo}` } : null;
}

/** Fetch the card and store `reasoning` on the record. Returns the stored value, or undefined. */
export async function recordModelCardReasoning(model: DownloadedModel): Promise<boolean | undefined> {
  if (model.reasoning !== undefined) return model.reasoning;
  const repo = repoOf(model);
  if (!repo) return undefined;
  let card: string;
  try {
    const response = await fetch(modelCardUrl(repo.repoId, repo.revision));
    if (!response.ok) return undefined;
    card = await response.text();
  } catch {
    return undefined;
  }
  const reasoning = !modelCardDeniesReasoning(card);
  const models = useAppStore.getState().downloadedModels;
  await commitModelsList(models.map(m => (m.id === model.id ? { ...m, reasoning } : m)));
  logger.log(`[ModelCard] ${repo.repoId}: reasoning=${reasoning}`);
  return reasoning;
}
