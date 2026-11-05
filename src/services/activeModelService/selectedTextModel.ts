import type { DownloadedModel } from '../../types';
import { resolveDownloadedModel } from './resolveModel';

interface SelectedTextModelDeps {
  /** The selection and the list, read together so they are always the same instant. */
  read: () => {
    models: readonly DownloadedModel[];
    selectedId: string | null;
  };
  warn: (message: string) => void;
}

/**
 * The resolver for "which text model is selected", with drift reported once per id.
 *
 * Separate from the service so the rule is testable without the store, and so the service keeps one
 * responsibility per member. The remembered id is the only state here: a warning per render would
 * bury the signal it exists to raise.
 */
export function createSelectedTextModelResolver(
  deps: SelectedTextModelDeps,
): () => DownloadedModel | null {
  let reported: string | null = null;
  return () => {
    const { models, selectedId } = deps.read();
    const { model, matchedBy } = resolveDownloadedModel(models, selectedId);
    if (selectedId && matchedBy !== 'id' && reported !== selectedId) {
      reported = selectedId;
      deps.warn(
        `[ActiveModel] selected id did not match the downloaded list (matchedBy=${matchedBy}, models=${models.length})`,
      );
    }
    return model;
  };
}

/**
 * The id to load for a turn: the current selection, or the remembered choice when a user unload
 * cleared the selection. PURE.
 *
 * The ONE place that ordering is decided. Callers used to write `activeModelId ?? lastTextModelId`
 * inline, and the chat's load path read `lastTextModelId` ALONE - which is only written when a model is
 * picked from a sheet. So after a load that came from anywhere else the two disagreed, and chat loaded
 * the older model while the newer one sat selected on screen (device, 2026-07-31: picked Qwen 3.5,
 * loaded SmolVLM).
 */
export function selectedTextModelIdOf(state: {
  activeModelId: string | null;
  lastTextModelId: string | null;
}): string | null {
  return state.activeModelId ?? state.lastTextModelId;
}

/**
 * The chat selection to keep once the downloaded list is known: a selection that is the intent
 * classifier goes back to the person's last pick. PURE.
 *
 * The classifier borrows the text engine, and the loader used to record every successful load as the
 * chat selection, so a phone can hold the classifier (SmolLM2-135M) as its chat model (device,
 * 2026-11-05: Gemma 4 picked, SmolLM2 answering). It runs where the list arrives, because the list is
 * not persisted: on launch it is empty until the scan fills it. `lastTextModelId` is written only by a
 * real pick, so a person who chose the classifier themselves keeps it.
 */
export function repairedTextSelection(state: {
  activeModelId: string | null;
  lastTextModelId: string | null;
  classifierModelId: string | null | undefined;
  models: readonly { id: string }[];
}): string | null {
  const { activeModelId, lastTextModelId, classifierModelId, models } = state;
  if (!classifierModelId || activeModelId !== classifierModelId) return activeModelId;
  if (!lastTextModelId || lastTextModelId === classifierModelId) return activeModelId;
  return models.some(m => m.id === lastTextModelId) ? lastTextModelId : activeModelId;
}
