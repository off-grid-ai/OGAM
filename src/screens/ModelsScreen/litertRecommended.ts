import { ModelInfo } from '../../types';
import { buildCuratedLiteRTFiles, LITERT_PARENT_ID, type CuratedLiteRTEntry } from '../../services/curatedLiteRTRegistry';

// LiteRT-specific per-file metadata (display name + highlight) used to render
// individual file cards in the detail view. Derived from the curated registry —
// the registry is the single source of truth; this map is just a UI-shaped view.
export const liteRTFileMeta = (
  entries: readonly CuratedLiteRTEntry[],
): Record<string, { displayName: string; highlight: string }> =>
  Object.fromEntries(entries.map(e => [e.fileName, { displayName: e.displayName, highlight: e.highlight }]));

// Synthetic parent ModelInfo whose `files` are derived from the curated registry.
// Adding a new curated LiteRT model only requires updating the registry — this
// list, the display map above, and the download flow all pick it up automatically.
export const liteRTRecommendedModel = (entries: readonly CuratedLiteRTEntry[]): ModelInfo => ({
  id: LITERT_PARENT_ID,
  name: 'Gemma 4 LiteRT',
  author: 'google',
  description: 'Hardware-accelerated inference with vision support.',
  downloads: 0, likes: 0, tags: ['litert'], lastModified: '',
  modelType: 'vision',
  files: buildCuratedLiteRTFiles(entries),
});

export const LITERT_PARENT_RECOMMENDED = {
  pillLabel: 'Recommended',
  chips: ['Vision', 'GPU'],
  // No highlightText — the model description already carries it (rendered commonly).
};
