/**
 * The intent classifier (SmolLM2-135M) is a utility model: the app downloads it in the background to
 * decide whether a message asks for a picture. It is never a chat model, so nothing that picks or
 * counts chat models may include it. One rule, used by every such place.
 */
export const CLASSIFIER_REPO = 'bartowski/SmolLM2-135M-Instruct-GGUF';

/** Whether a downloaded model is the intent classifier: its repo, or the one settings point to. */
export function isClassifierModel(id: string, classifierModelId?: string | null): boolean {
  return id.startsWith(`${CLASSIFIER_REPO}/`) || (!!classifierModelId && id === classifierModelId);
}
