/**
 * PURE capability detectors for a remote model, keyed off its id/name. They live in the pure layer
 * (not in remoteServerManagerUtils, which also has store-touching manager functions) so the store
 * layer (remoteServerHelpers) can import them WITHOUT depending on the service — the service imports
 * the store, so the store-helper importing the service back formed a cycle. remoteServerManagerUtils
 * re-exports these for its public API.
 */
import { looksLikeVisionModel } from './visionModel';

/** Vision (multimodal) capability from the model id — single source of truth (utils/visionModel). */
export function detectVisionCapability(modelId: string): boolean {
  return looksLikeVisionModel({ id: modelId, name: modelId });
}

/** Tool/function-calling capability inferred from the model id/family. */
export function detectToolCallingCapability(modelId: string): boolean {
  const patterns = [
    'gpt-4', 'gpt-3.5-turbo', 'claude', 'gemini', 'mistral',
    'qwen', 'llama-3', 'command-r', 'dbrx', 'firefunction',
  ];
  const lower = modelId.toLowerCase();
  if (patterns.some(p => lower.includes(p))) return true;
  if (lower.includes('tool') || lower.includes('function')) return true;
  return false;
}
