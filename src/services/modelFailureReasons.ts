/**
 * Pure model-failure reason + copy — the single source for "map a load error to a
 * typed reason" and "the user-facing copy for a reason". UI-FREE on purpose: both
 * the service layer (modelFailureHandler) and the screen layer (modelReadiness'
 * alert path) depend on it, so it must not import any component/UI module. (When
 * this lived in the screen module, importing it from a service dragged the
 * components barrel → ModelCard → native vector-icons into non-UI test envs.)
 */

export type ModelNotReadyReason =
  | 'no-model-selected' // no text model is selected/active for this chat
  | 'not-downloaded' // the selected model is not on disk
  | 'insufficient-memory' // could not fit the model in the residency budget
  | 'load-in-progress' // a load is already running; do not start a second
  | 'load-threw'; // the native load attempt failed

/** Map a thrown load error to a typed reason (the one place this heuristic lives). */
export function reasonFromLoadError(err: unknown): ModelNotReadyReason {
  const msg = err instanceof Error ? err.message : String(err);
  if (/not found|no such file|missing|does not exist/i.test(msg)) return 'not-downloaded';
  if (/memory|insufficient|\boom\b|jetsam|out of/i.test(msg)) return 'insufficient-memory';
  return 'load-threw';
}

/** User-facing alert copy for a not-ready reason (the one place this copy lives). */
export function modelNotReadyAlert(
  reason: ModelNotReadyReason,
  detail?: string,
): { title: string; message: string } {
  switch (reason) {
    case 'no-model-selected':
      return { title: 'No Model Selected', message: 'Choose a text model to start chatting.' };
    case 'not-downloaded':
      return {
        title: 'Model Not Downloaded',
        message: "That model isn't on your device yet. Download it from the Models screen.",
      };
    case 'insufficient-memory':
      return {
        title: 'Not Enough Memory',
        message:
          `${detail ? `${detail}\n\n` : ''}` +
          'Close other apps to free up memory, then tap Retry. You can also unload other models from the Home screen.',
      };
    case 'load-in-progress':
      return {
        title: 'Still Loading',
        message: 'The model is still loading. Give it a moment, then try again.',
      };
    case 'load-threw':
    default:
      return {
        title: 'Failed to Load Model',
        message: detail
          ? `The model failed to load: ${detail}`
          : 'The model failed to load. Please try again.',
      };
  }
}
