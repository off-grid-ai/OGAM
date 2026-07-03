/**
 * Capability dispatch for the active text model — the SINGLE source of truth for
 * "does the active model support vision / tool-calling / thinking / audio input".
 *
 * The rule is engine-aware (remote vs LiteRT vs llama.cpp) and used to be
 * recomputed inline 5+ times across the ChatScreen hooks
 * (`engine === 'litert' ? … : llmService…`). Defining it ONCE here — behind the
 * activeModelService seam — is what lets UI/hooks stop branching on engine type.
 *
 * Precedence: a remote model (its advertised capabilities) takes priority over
 * any selected local model, matching the ChatScreen's activeModelInfo resolution.
 */

import { useAppStore, useRemoteServerStore } from '../../stores';
import { llmService } from '../llm';
import { liteRTService } from '../litert';

/** The advertised capabilities of the active remote text model, or null. */
function activeRemoteCapabilities():
  | { supportsVision: boolean; supportsToolCalling: boolean; supportsThinking: boolean }
  | null {
  const remote = useRemoteServerStore.getState().getActiveRemoteTextModel();
  return remote ? remote.capabilities : null;
}

/** The active LOCAL text model, or null (remote models are not in this store). */
function activeLocalModel() {
  const store = useAppStore.getState();
  return store.downloadedModels.find(m => m.id === store.activeModelId) ?? null;
}

/**
 * Whether the active text model accepts audio input directly (no Whisper STT).
 *   - LiteRT → its loaded model's audio flag
 *   - llama  → the loaded multimodal projector's reported audio support
 * (Remote has no direct-audio path here, matching prior behavior.)
 */
export function supportsAudioInput(): boolean {
  const model = activeLocalModel();
  if (!model) return false;
  if (model.engine === 'litert') {
    return liteRTService.supportsAudio();
  }
  return llmService.isModelLoaded() && !!llmService.getMultimodalSupport()?.audio;
}

/**
 * Whether the active text model accepts image input.
 *   - remote → advertised `supportsVision`
 *   - LiteRT → the static `liteRTVision` flag (known before load)
 *   - llama  → the loaded projector's reported vision support
 */
export function supportsVision(): boolean {
  const remote = activeRemoteCapabilities();
  if (remote) return remote.supportsVision;
  const model = activeLocalModel();
  if (!model) return false;
  if (model.engine === 'litert') {
    return !!model.liteRTVision;
  }
  return llmService.isModelLoaded() && !!llmService.getMultimodalSupport()?.vision;
}

/**
 * Whether the active text model supports function/tool calling.
 *   - remote → advertised `supportsToolCalling`
 *   - LiteRT → true once loaded (the LiteRT tool path is always available)
 *   - llama  → the loaded model's reported tool-calling support
 */
export function supportsToolCalling(): boolean {
  const remote = activeRemoteCapabilities();
  if (remote) return remote.supportsToolCalling;
  const model = activeLocalModel();
  if (!model) return false;
  if (model.engine === 'litert') {
    return liteRTService.isModelLoaded();
  }
  return llmService.isModelLoaded() && llmService.supportsToolCalling();
}

/**
 * Whether the active text model supports extended thinking (reasoning tokens).
 *   - remote → advertised `supportsThinking`
 *   - LiteRT → true once loaded
 *   - llama  → the loaded model's reported thinking support
 */
export function supportsThinking(): boolean {
  const remote = activeRemoteCapabilities();
  if (remote) return remote.supportsThinking;
  const model = activeLocalModel();
  if (!model) return false;
  if (model.engine === 'litert') {
    return liteRTService.isModelLoaded();
  }
  return llmService.isModelLoaded() && llmService.supportsThinking();
}
