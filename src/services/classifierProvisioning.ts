/**
 * Auto-provisions a small default intent-classifier model (SmolLM2-135M) so
 * LLM-based routing works out of the box without the user manually picking a
 * classifier. Downloads in the background via the normal text-model path (so it
 * shows in the Download Manager) and sets it as settings.classifierModelId on
 * completion. No-op once a usable classifier is configured.
 *
 * See docs/design/MODEL_ROUTING.md §5.3.
 */
import { useAppStore } from '../stores';
import { modelManager } from './modelManager';
import { huggingFaceService } from './huggingface';
import { startModelDownload } from './startModelDownload';

/** SmolLM2-135M-Instruct GGUF — ~100-145MB, runs on llama.rn. */
const CLASSIFIER_REPO = 'bartowski/SmolLM2-135M-Instruct-GGUF';

let provisioning = false;

function hasUsableClassifier(): boolean {
  const { settings, downloadedModels } = useAppStore.getState();
  return !!settings.classifierModelId && downloadedModels.some(m => m.id === settings.classifierModelId);
}

/**
 * Ensure a default classifier model is downloaded and selected. Safe to call
 * repeatedly (guards against duplicate downloads). Resolves immediately; the
 * download proceeds in the background.
 */
export async function ensureDefaultClassifier(): Promise<void> {
  if (hasUsableClassifier() || provisioning) return;

  const store = useAppStore.getState();
  // Already downloaded the default (e.g. selection was cleared)? Just select it.
  const existing = store.downloadedModels.find(m => m.id.startsWith(`${CLASSIFIER_REPO}/`));
  if (existing) {
    store.updateSettings({ classifierModelId: existing.id });
    return;
  }

  if (!modelManager.isBackgroundDownloadSupported?.()) return;

  provisioning = true;
  try {
    const files = await huggingFaceService.getModelFiles(CLASSIFIER_REPO);
    const ggufs = files
      .filter(f => f.name.toLowerCase().endsWith('.gguf'))
      .sort((a, b) => (a.size || 0) - (b.size || 0));
    // Prefer Q8_0 (best quality at this tiny size), else the smallest GGUF.
    const file = ggufs.find(f => /q8_0/i.test(f.name)) ?? ggufs[0];
    if (!file) {
      provisioning = false;
      return;
    }
    // Route through THE single download entry point instead of a parallel
    // downloadModelBackground + watchDownload. startModelDownload registers the model
    // AND clears the in-flight downloadStore row on completion; the old parallel path
    // never cleared the row, so after the classifier finished it lingered forever as a
    // phantom "downloading 100%" entry in the Download Manager (its uniform id —
    // text:<repo> — never matched the finished model's text:<repo>/<file>, so the
    // one-entry dedup couldn't collapse it).
    let settled = false;
    await startModelDownload(CLASSIFIER_REPO, file, {
      onRegistered: (model) => {
        settled = true;
        useAppStore.getState().updateSettings({ classifierModelId: model.id });
        provisioning = false;
      },
      onError: () => { settled = true; provisioning = false; },
    });
    // startModelDownload can return without firing either callback (already-active
    // download, or a queued start that was cancelled). Don't leave provisioning stuck
    // true forever — that would block every future classifier selection attempt.
    if (!settled) provisioning = false;
  } catch {
    provisioning = false;
  }
}
